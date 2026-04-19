import { error, fail, redirect } from '@sveltejs/kit';
import { loadAppConfig, readYaml, writeYaml } from '$lib/storage';
import { VolunteersFile } from '$lib/schemas';
import { parseVolunteerForm } from '$lib/volunteerForm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const config = await loadAppConfig();
	const volunteer = config.volunteers.find((v) => v.id === params.id);
	if (!volunteer) error(404, `Volunteer '${params.id}' not found`);
	return { config, volunteer };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
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
	}
};
