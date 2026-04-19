import { loadAppConfig } from '$lib/storage';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const config = await loadAppConfig();
	return { config };
};
