import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { error, fail, redirect } from '@sveltejs/kit';
import { DATA_DIR, exists, loadAppConfig, readYaml, writeYaml } from '$lib/storage';
import {
	DateYYYYMMDD,
	EventFile,
	MonthYYYYMM,
	type EventChurchBlock,
	type EventShift
} from '$lib/schemas';
import type { Actions, PageServerLoad } from './$types';

/**
 * Slugify a user-entered event name into a filesystem-safe ID. The slug is
 * also used as the stable event id so cross-file references stay readable.
 */
function slugify(s: string): string {
	return (
		s
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'event'
	);
}

/** Collect existing event ids for the month so we can disambiguate collisions. */
async function existingEventIds(month: string): Promise<Set<string>> {
	const ids = new Set<string>();
	if (!(await exists('events'))) return ids;
	const prefix = month + '-';
	const files = (await readdir(join(DATA_DIR, 'events'))).filter(
		(f) => f.startsWith(prefix) && f.endsWith('.yaml')
	);
	for (const f of files) {
		const ev = await readYaml(`events/${f}`, EventFile);
		ids.add(ev.id);
	}
	return ids;
}

export const load: PageServerLoad = async ({ params }) => {
	const month = MonthYYYYMM.safeParse(params.month);
	if (!month.success) error(400, 'Invalid month');
	const config = await loadAppConfig();
	return { month: month.data, config };
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const dateStr = String(form.get('date') ?? '').trim();
		const churchIds = form
			.getAll('churchIds')
			.map((v) => String(v).trim())
			.filter(Boolean);

		const values = { name, date: dateStr, churchIds };

		const monthParsed = MonthYYYYMM.safeParse(params.month);
		if (!monthParsed.success) {
			return fail(400, { error: 'Invalid month', values });
		}
		const month = monthParsed.data;

		if (!name) {
			return fail(400, { error: 'Nama acara wajib diisi', values });
		}
		const date = DateYYYYMMDD.safeParse(dateStr);
		if (!date.success) {
			return fail(400, { error: 'Tanggal tidak valid', values });
		}
		if (!date.data.startsWith(month + '-')) {
			return fail(400, { error: 'Tanggal harus berada di bulan yang dipilih', values });
		}
		if (churchIds.length === 0) {
			return fail(400, { error: 'Pilih minimal satu gereja', values });
		}

		const config = await loadAppConfig();
		const knownChurches = new Map(config.churches.map((c) => [c.id, c]));
		for (const cid of churchIds) {
			if (!knownChurches.has(cid)) {
				return fail(400, { error: `Gereja tidak dikenal: '${cid}'`, values });
			}
		}

		// Disambiguate event id against existing events in this month.
		const takenIds = await existingEventIds(month);
		let id = slugify(name);
		if (takenIds.has(id)) {
			let n = 2;
			while (takenIds.has(`${id}-${n}`) && n < 1000) n++;
			id = `${id}-${n}`;
		}

		// Clone each church's weekly shifts into event shifts so the event has
		// meaningful slots to schedule from day one. Services stay empty so the
		// resolver defaults to the church's Sunday services (matches Jumat Agung
		// pattern where events reuse normal Sunday lineups).
		const churches: EventChurchBlock[] = churchIds.map((cid) => {
			const church = knownChurches.get(cid)!;
			const shifts: EventShift[] = church.weeklyShifts.map((ws) => ({
				id: ws.id,
				label: ws.label,
				serviceIds: ws.serviceIds,
				requiredVolunteers: ws.requiredVolunteers
			}));
			return {
				churchId: cid,
				services: [],
				shifts,
				assignments: []
			};
		});

		const event = { id, name, date: date.data, churches };
		const parsed = EventFile.safeParse(event);
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Data acara tidak valid',
				values
			});
		}

		const filename = `${date.data}-${id}.yaml`;
		await writeYaml(`events/${filename}`, EventFile, parsed.data);
		redirect(303, `/schedule/${month}`);
	}
};
