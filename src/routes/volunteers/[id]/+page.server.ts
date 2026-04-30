import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { error, fail, redirect } from '@sveltejs/kit';
import { DATA_DIR, exists, loadAppConfig, readYaml, writeYaml } from '$lib/storage';
import { UnavailabilityFile, VolunteersFile } from '$lib/schemas';
import { parseVolunteerForm } from '$lib/volunteerForm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const config = await loadAppConfig();
	const volunteer = config.volunteers.find((v) => v.id === params.id);
	if (!volunteer) error(404, `Volunteer '${params.id}' not found`);
	return { config, volunteer };
};

export const actions: Actions = {
	update: async ({ request, params }) => {
		const form = await request.formData();
		// Force id from the route — editing identity is not supported here.
		form.set('id', params.id!);
		const values: Record<string, string> = Object.fromEntries(form.entries()) as Record<
			string,
			string
		>;

		const result = parseVolunteerForm(form);
		if (!result.ok) {
			const fieldErrors: Record<string, string> = result.fieldErrors;
			return fail(400, { error: result.error, fieldErrors, values });
		}

		const volunteers = await readYaml('volunteers.yaml', VolunteersFile);
		const idx = volunteers.findIndex((v) => v.id === params.id);
		if (idx === -1) {
			const fieldErrors: Record<string, string> = {};
			return fail(404, {
				error: `Volunteer '${params.id}' not found`,
				fieldErrors,
				values
			});
		}

		const config = await loadAppConfig();
		const churchIds = new Set(config.churches.map((c) => c.id));
		if (result.volunteer.homeChurchId && !churchIds.has(result.volunteer.homeChurchId)) {
			const fieldErrors: Record<string, string> = { homeChurchId: 'unknown church' };
			return fail(400, {
				error: `Unknown homeChurchId '${result.volunteer.homeChurchId}'`,
				fieldErrors,
				values
			});
		}
		for (const cid of result.volunteer.assignableChurchIds) {
			if (!churchIds.has(cid)) {
				const fieldErrors: Record<string, string> = {
					assignableChurchIds: `unknown church '${cid}'`
				};
				return fail(400, {
					error: `Unknown church '${cid}' in assignableChurchIds`,
					fieldErrors,
					values
				});
			}
		}

		volunteers[idx] = result.volunteer;
		volunteers.sort((a, b) => a.name.localeCompare(b.name));
		await writeYaml('volunteers.yaml', VolunteersFile, volunteers);

		redirect(303, '/volunteers');
	},

	/**
	 * Permanently remove a volunteer from volunteers.yaml and strip them from
	 * every monthly unavailability file. Past schedule/event assignments keep
	 * their dangling volunteerId — those rows are historical record, and the
	 * cross-ref check in `loadAppConfig` doesn't validate assignment refs, so
	 * the app keeps loading. The roster table will fall back to showing the
	 * stale id, which is the correct trail for an admin investigating "who
	 * was that?" months later.
	 *
	 * If the admin only wants to pause someone, the Aktif checkbox / toggle
	 * is the safer move — this delete is irreversible.
	 */
	delete: async ({ params }) => {
		const volunteers = await readYaml('volunteers.yaml', VolunteersFile);
		const idx = volunteers.findIndex((v) => v.id === params.id);
		if (idx === -1) {
			return fail(404, { error: `Volunteer '${params.id}' not found` });
		}

		volunteers.splice(idx, 1);
		await writeYaml('volunteers.yaml', VolunteersFile, volunteers);

		// Best-effort cleanup of unavailability/*.yaml so the matrix and the
		// saveUnavailability cross-ref check don't trip over a now-unknown id.
		if (await exists('unavailability')) {
			const files = (await readdir(join(DATA_DIR, 'unavailability'))).filter((f) =>
				f.endsWith('.yaml')
			);
			for (const f of files) {
				const rel = `unavailability/${f}`;
				const file = await readYaml(rel, UnavailabilityFile);
				const before = file.entries.length;
				file.entries = file.entries.filter((e) => e.volunteerId !== params.id);
				if (file.entries.length !== before) {
					await writeYaml(rel, UnavailabilityFile, file);
				}
			}
		}

		redirect(303, '/volunteers');
	}
};
