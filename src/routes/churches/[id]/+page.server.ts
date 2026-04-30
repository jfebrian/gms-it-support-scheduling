import { error, fail, redirect } from '@sveltejs/kit';
import { loadAppConfig, readYaml, writeYaml } from '$lib/storage';
import {
	Church,
	ChurchesFile,
	VolunteersFile,
	YouTubeChannelsFile
} from '$lib/schemas';
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
	update: async ({ request, params }) => {
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
	},

	/**
	 * Permanently remove a church from churches.yaml. Because `loadAppConfig`
	 * cross-validates church refs in volunteers.yaml and youtube_channels.yaml,
	 * deleting a church without scrubbing those refs would brick the whole app
	 * on next load. So we also:
	 *   - clear `homeChurchId` on any volunteer that pointed at this church
	 *   - drop the id from every volunteer's `assignableChurchIds`
	 *   - drop the id from every YouTube channel's `servesChurchIds`
	 *
	 * Past schedule/event assignments keep their dangling churchId. They're
	 * historical record and the schedule view tolerates unknown ids (it falls
	 * back to displaying the id as-is). Forward-looking schedules will be
	 * regenerated when the admin re-runs Populate.
	 */
	delete: async ({ params }) => {
		const churches = await readYaml('churches.yaml', ChurchesFile);
		const idx = churches.findIndex((c) => c.id === params.id);
		if (idx === -1) {
			return fail(404, {
				error: `Church '${params.id}' not found`,
				issues: []
			} satisfies ChurchFormFail);
		}

		churches.splice(idx, 1);
		await writeYaml('churches.yaml', ChurchesFile, churches);

		// Clean up volunteer cross-refs.
		const volunteers = await readYaml('volunteers.yaml', VolunteersFile);
		let volunteersChanged = false;
		for (const v of volunteers) {
			if (v.homeChurchId === params.id) {
				v.homeChurchId = null;
				volunteersChanged = true;
			}
			const before = v.assignableChurchIds.length;
			v.assignableChurchIds = v.assignableChurchIds.filter((cid) => cid !== params.id);
			if (v.assignableChurchIds.length !== before) volunteersChanged = true;
		}
		if (volunteersChanged) {
			await writeYaml('volunteers.yaml', VolunteersFile, volunteers);
		}

		// Clean up YouTube channel cross-refs.
		const channels = await readYaml('youtube_channels.yaml', YouTubeChannelsFile);
		let channelsChanged = false;
		for (const ch of channels) {
			const before = ch.servesChurchIds.length;
			ch.servesChurchIds = ch.servesChurchIds.filter((cid) => cid !== params.id);
			if (ch.servesChurchIds.length !== before) channelsChanged = true;
		}
		if (channelsChanged) {
			await writeYaml('youtube_channels.yaml', YouTubeChannelsFile, channels);
		}

		redirect(303, '/churches');
	}
};
