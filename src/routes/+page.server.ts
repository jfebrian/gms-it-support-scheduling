import { redirect } from '@sveltejs/kit';
import { currentMonthYYYYMM } from '$lib/dates';
import type { PageServerLoad } from './$types';

// The dashboard has been retired — the schedule is the app's home. Redirect
// "/" straight to the current month's schedule so there's no extra hop.
export const load: PageServerLoad = () => {
	redirect(303, `/schedule/${currentMonthYYYYMM()}`);
};
