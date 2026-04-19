import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { error } from '@sveltejs/kit';
import { DATA_DIR, exists, loadAppConfig, readYaml } from '$lib/storage';
import { EventFile, MonthlySchedule, MonthYYYYMM } from '$lib/schemas';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const parsed = MonthYYYYMM.safeParse(params.month);
	if (!parsed.success) error(400, `Invalid month "${params.month}" — expected YYYY-MM`);
	const month = parsed.data;

	const config = await loadAppConfig();

	const schedulePath = `schedules/${month}.yaml`;
	const schedule = (await exists(schedulePath))
		? await readYaml(schedulePath, MonthlySchedule)
		: null;

	const events: EventFile[] = [];
	if (await exists('events')) {
		const prefix = month + '-';
		const files = (await readdir(join(DATA_DIR, 'events'))).filter(
			(f) => f.startsWith(prefix) && f.endsWith('.yaml')
		);
		for (const f of files) {
			events.push(await readYaml(`events/${f}`, EventFile));
		}
	}

	return { month, config, schedule, events };
};
