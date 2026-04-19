import { fail, redirect } from '@sveltejs/kit';
import { loadAppConfig, readYaml, writeYaml } from '$lib/storage';
import { VolunteersFile } from '$lib/schemas';
import { parseVolunteerForm } from '$lib/volunteerForm';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const config = await loadAppConfig();
	return { config };
};

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
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
		if (volunteers.some((v) => v.id === result.volunteer.id)) {
			const fieldErrors: Record<string, string> = { id: 'already in use' };
			return fail(409, {
				error: `Volunteer id '${result.volunteer.id}' already exists`,
				fieldErrors,
				values
			});
		}

		// Cross-reference check: homeChurchId + assignableChurchIds must exist.
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

		volunteers.push(result.volunteer);
		volunteers.sort((a, b) => a.name.localeCompare(b.name));
		await writeYaml('volunteers.yaml', VolunteersFile, volunteers);

		redirect(303, '/volunteers');
	}
};
