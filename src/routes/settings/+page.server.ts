import { fail, redirect } from '@sveltejs/kit';
import { readYaml, writeYaml } from '$lib/storage';
import { Settings } from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const settings = await readYaml('settings.yaml', Settings);
	return { settings };
};

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();

		const supportedLocalesRaw = String(form.get('supportedLocales') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);

		const candidate = {
			timezone: String(form.get('timezone') ?? 'Asia/Jakarta').trim(),
			i18n: {
				defaultLocale: String(form.get('defaultLocale') ?? 'en').trim(),
				supportedLocales:
					supportedLocalesRaw.length > 0 ? supportedLocalesRaw : ['en', 'id']
			},
			scheduling: {
				defaultMaxHoursPerDay: Number(form.get('defaultMaxHoursPerDay') ?? 8),
				defaultServiceDurationMinutes: Number(
					form.get('defaultServiceDurationMinutes') ?? 90
				)
			},
			youtube: {
				pollingIntervalSeconds: Number(form.get('pollingIntervalSeconds') ?? 60),
				bufferingWindowSeconds: Number(form.get('bufferingWindowSeconds') ?? 120),
				bufferingThresholdCount: Number(form.get('bufferingThresholdCount') ?? 5),
				streamDownGraceSeconds: Number(form.get('streamDownGraceSeconds') ?? 30)
			}
		};

		const parsed = Settings.safeParse(candidate);
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Invalid settings',
				values: candidate
			});
		}

		await writeYaml('settings.yaml', Settings, parsed.data);
		redirect(303, '/settings');
	}
};
