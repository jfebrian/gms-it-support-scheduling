import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/**
 * Unavailability is now a tab on the schedule page. Keep this route as a
 * permanent redirect so old bookmarks don't 404. Remove once all links
 * outside the repo have updated.
 */
export const load: PageServerLoad = async ({ params }) => {
	redirect(308, `/schedule/${params.month}?tab=unavailability`);
};
