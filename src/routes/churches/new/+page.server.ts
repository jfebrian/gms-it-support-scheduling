import { fail, redirect } from '@sveltejs/kit';
import { loadAppConfig, readYaml, writeYaml } from '$lib/storage';
import { Church, ChurchesFile, HexColor } from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const config = await loadAppConfig();
	return { config };
};

/**
 * Derive a stable, kebab-case ID from a human-entered name. Same rules as the
 * volunteers flow — collisions fall back to `-2`, `-3`, etc. We do this
 * server-side as well as in the client so the page still works if JS is off
 * and so we aren't trusting a client-supplied ID.
 */
function slugify(s: string): string {
	return (
		s
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'gereja'
	);
}
function uniqueId(base: string, taken: ReadonlySet<string>): string {
	const slug = slugify(base);
	if (!taken.has(slug)) return slug;
	for (let n = 2; n < 1000; n++) {
		const c = `${slug}-${n}`;
		if (!taken.has(c)) return c;
	}
	return `${slug}-${Date.now()}`;
}

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const values: Record<string, string> = Object.fromEntries(form.entries()) as Record<
			string,
			string
		>;

		const name = String(form.get('name') ?? '').trim();
		const colorRaw = String(form.get('color') ?? '').trim();
		const livestream = form.get('livestream') === 'on';
		const ytRaw = String(form.get('youtubeChannelId') ?? '').trim();

		const fieldErrors: Record<string, string> = {};
		if (!name) fieldErrors.name = 'Nama wajib diisi';

		const colorParse = HexColor.safeParse(colorRaw);
		if (!colorParse.success) {
			fieldErrors.color =
				colorParse.error.issues[0]?.message ?? 'Warna harus format #RRGGBB';
		}

		if (Object.keys(fieldErrors).length > 0) {
			return fail(400, {
				error: Object.values(fieldErrors)[0] ?? 'Data tidak valid',
				fieldErrors,
				values
			});
		}

		// Load full config + churches.yaml to cross-reference the channel and to
		// append the new entry. Keep validation strict here: a bad YT channel
		// should fail fast rather than creating a dangling reference.
		const config = await loadAppConfig();
		const churches = await readYaml('churches.yaml', ChurchesFile);
		const takenIds = new Set(churches.map((c) => c.id));
		const id = uniqueId(name, takenIds);

		let youtubeChannelId: string | null = null;
		if (livestream && ytRaw) {
			const channelIds = new Set(config.youtubeChannels.map((c) => c.id));
			if (!channelIds.has(ytRaw)) {
				const fe: Record<string, string> = { youtubeChannelId: 'unknown channel' };
				return fail(400, {
					error: `Channel YouTube '${ytRaw}' tidak dikenali`,
					fieldErrors: fe,
					values
				});
			}
			youtubeChannelId = ytRaw;
		}

		// Build a bare-bones church. `weeklyServices` / `weeklyShifts` start empty;
		// the user lands on the edit page immediately after creation to fill them
		// in — which keeps this form short (name + color + livestream is ~3 fields
		// vs. the 10+-field nested editor on the edit page).
		const candidate = {
			id,
			name,
			livestream,
			youtubeChannelId,
			color: colorParse.data,
			weeklyServices: [],
			weeklyShifts: []
		};

		const result = Church.safeParse(candidate);
		if (!result.success) {
			const fe: Record<string, string> = {};
			return fail(400, {
				error: result.error.issues[0]?.message ?? 'Data gereja tidak valid',
				fieldErrors: fe,
				values
			});
		}

		churches.push(result.data);
		churches.sort((a, b) => a.name.localeCompare(b.name));
		await writeYaml('churches.yaml', ChurchesFile, churches);

		// Jump straight into the edit page so the user can start adding services
		// and shifts without a second click.
		redirect(303, `/churches/${id}`);
	}
};
