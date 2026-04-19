import { fail, redirect } from '@sveltejs/kit';
import { loadAppConfig, readYaml, writeYaml } from '$lib/storage';
import { VolunteersFile } from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const config = await loadAppConfig();
	return { config };
};

export const actions: Actions = {
	/**
	 * Flip a volunteer's active flag. The only remaining caller is the
	 * Deactivate/Reactivate button inside the edit sheet — we keep the
	 * action on the list page so the logic stays in one place, then
	 * redirect back to the list so the admin sees the updated status.
	 */
	toggleActive: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id) return fail(400, { error: 'missing id' });

		const volunteers = await readYaml('volunteers.yaml', VolunteersFile);
		const idx = volunteers.findIndex((v) => v.id === id);
		if (idx === -1) return fail(404, { error: `volunteer '${id}' not found` });

		volunteers[idx] = { ...volunteers[idx], active: !volunteers[idx].active };
		await writeYaml('volunteers.yaml', VolunteersFile, volunteers);
		redirect(303, '/volunteers');
	}
};
