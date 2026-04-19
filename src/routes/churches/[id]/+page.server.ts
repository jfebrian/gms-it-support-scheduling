import { error, fail, redirect } from '@sveltejs/kit';
import { loadAppConfig, readYaml, writeYaml } from '$lib/storage';
import { Church, ChurchesFile } from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const config = await loadAppConfig();
	const church = config.churches.find((c) => c.id === params.id);
	if (!church) error(404, `Church '${params.id}' not found`);
	return { config, church };
};

type ChurchFormFail = {
	error: string;
	issues: Array<{ path: string[]; message: string }>;
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const form = await request.formData();
		const payload = String(form.get('payload') ?? '');
		let parsedJson: unknown;
		try {
			parsedJson = JSON.parse(payload);
		} catch {
			return fail(400, {
				error: 'Invalid payload (not JSON)',
				issues: []
			} satisfies ChurchFormFail);
		}

		// Force id from the route — identity is immutable.
		if (typeof parsedJson === 'object' && parsedJson !== null) {
			(parsedJson as { id: string }).id = params.id!;
		}

		const result = Church.safeParse(parsedJson);
		if (!result.success) {
			const issues: ChurchFormFail['issues'] = result.error.issues.map((i) => ({
				path: i.path.map((p) => String(p)),
				message: i.message
			}));
			return fail(400, {
				error: result.error.issues[0]?.message ?? 'Invalid church data',
				issues
			});
		}

		const churches = await readYaml('churches.yaml', ChurchesFile);
		const idx = churches.findIndex((c) => c.id === params.id);
		if (idx === -1) {
			return fail(404, {
				error: `Church '${params.id}' not found`,
				issues: []
			} satisfies ChurchFormFail);
		}

		// Cross-reference: youtubeChannelId must exist (when set). If livestream
		// is off, force the channel to null — mirrors the UI convention that
		// non-livestream churches don't point at a YT channel.
		const config = await loadAppConfig();
		const channelIds = new Set(config.youtubeChannels.map((c) => c.id));
		if (!result.data.livestream) {
			result.data.youtubeChannelId = null;
		}
		if (result.data.youtubeChannelId && !channelIds.has(result.data.youtubeChannelId)) {
			return fail(400, {
				error: `Unknown youtubeChannelId '${result.data.youtubeChannelId}'`,
				issues: []
			} satisfies ChurchFormFail);
		}

		churches[idx] = result.data;
		await writeYaml('churches.yaml', ChurchesFile, churches);

		redirect(303, '/churches');
	}
};
