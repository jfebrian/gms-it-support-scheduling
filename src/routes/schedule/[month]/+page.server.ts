import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { error, fail, redirect } from '@sveltejs/kit';
import { DATA_DIR, exists, loadAppConfig, readYaml, writeYaml } from '$lib/storage';
import {
	DateYYYYMMDD,
	EventFile,
	MonthlySchedule,
	MonthYYYYMM,
	TimeHHMM,
	UnavailabilityFile
} from '$lib/schemas';
import { populateMonth, summarizeHistory } from '$lib/populate';
import { computeShiftHours, eventAssignmentId, weeklyAssignmentId } from '$lib/assignmentHelpers';
import { previousMonth } from '$lib/dates';
import type { Actions, PageServerLoad } from './$types';

/**
 * Load a single month's schedule (if any) and all event files for that month.
 * Used both by the populate action (for the target month) and for building
 * the 6-month look-back history that feeds long-term fairness scoring.
 */
async function loadMonthData(month: string): Promise<{
	schedule: MonthlySchedule | null;
	events: EventFile[];
}> {
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
	return { schedule, events };
}

export const load: PageServerLoad = async ({ params }) => {
	const parsed = MonthYYYYMM.safeParse(params.month);
	if (!parsed.success) error(400, `Invalid month "${params.month}" — expected YYYY-MM`);
	const month = parsed.data;

	const config = await loadAppConfig();

	const { schedule, events } = await loadMonthData(month);

	// Unavailability is edited on this page (as a tab) — load it here so the
	// Svelte page can hydrate the matrix without a second round-trip.
	const unavailabilityPath = `unavailability/${month}.yaml`;
	const unavailability = (await exists(unavailabilityPath))
		? await readYaml(unavailabilityPath, UnavailabilityFile)
		: { month, entries: [] };

	return { month, config, schedule, events, unavailability };
};

export const actions: Actions = {
	/**
	 * Randomize all non-confirmed slots for the month. Confirmed assignments
	 * are preserved and still count toward fairness. Writes the patched
	 * schedule and any touched event files back to disk atomically.
	 */
	populate: async ({ params, request }) => {
		const monthParsed = MonthYYYYMM.safeParse(params.month);
		if (!monthParsed.success) return fail(400, { error: 'Invalid month' });
		const month = monthParsed.data;

		// Optional form-provided seed — lets a "regenerate" button re-run with
		// a known seed. Empty/unparseable falls back to Date.now() inside
		// populateMonth.
		const form = await request.formData();
		const seedRaw = String(form.get('seed') ?? '').trim();
		const seedNum = seedRaw ? Number(seedRaw) : Number.NaN;

		const config = await loadAppConfig();
		const { schedule, events } = await loadMonthData(month);

		const unavailability = (await exists(`unavailability/${month}.yaml`))
			? await readYaml(`unavailability/${month}.yaml`, UnavailabilityFile)
			: { month, entries: [] };

		// Walk back 6 months so long-term fairness scoring can tell apart a
		// volunteer who served every previous month from one who hasn't served
		// in half a year. Missing months contribute zero — they just don't lift
		// anyone's historical count.
		const HISTORY_MONTHS = 6;
		const historyMonths: Array<{ schedule: MonthlySchedule | null; events: EventFile[] }> = [];
		let cursor = month;
		for (let i = 0; i < HISTORY_MONTHS; i++) {
			cursor = previousMonth(cursor);
			historyMonths.push(await loadMonthData(cursor));
		}
		const history = summarizeHistory(historyMonths);

		const result = populateMonth({
			config,
			month,
			schedule,
			events,
			unavailability,
			history,
			seed: Number.isFinite(seedNum) ? seedNum : undefined
		});

		// Write schedule.
		await writeYaml(`schedules/${month}.yaml`, MonthlySchedule, result.schedule);

		// Write each touched event file back (filename is derived the same way
		// the loader expects — `<date>-<slug>.yaml`). We read the original dirent
		// listing to preserve existing filenames rather than assuming a slug.
		const eventFiles = (await exists('events'))
			? (await readdir(join(DATA_DIR, 'events'))).filter(
					(f) => f.startsWith(month + '-') && f.endsWith('.yaml')
				)
			: [];
		const fileByEventId = new Map<string, string>();
		for (const f of eventFiles) {
			const ev = await readYaml(`events/${f}`, EventFile);
			fileByEventId.set(ev.id, f);
		}
		for (const [eventId, ev] of result.events) {
			const filename = fileByEventId.get(eventId);
			if (!filename) continue;
			await writeYaml(`events/${filename}`, EventFile, ev);
		}

		redirect(303, `/schedule/${month}`);
	},

	/**
	 * Save the unavailability matrix for this month. The payload is a JSON
	 * blob matching UnavailabilityFile shape. Malformed per-cell entries are
	 * dropped silently instead of rejecting the whole save so a single stale
	 * browser row doesn't lose a whole table of work.
	 */
	saveUnavailability: async ({ request, params }) => {
		const monthParsed = MonthYYYYMM.safeParse(params.month);
		if (!monthParsed.success) return fail(400, { error: 'Invalid month' });
		const month = monthParsed.data;

		const form = await request.formData();
		const payload = String(form.get('payload') ?? '');
		let raw: unknown;
		try {
			raw = JSON.parse(payload);
		} catch {
			return fail(400, { error: 'Invalid unavailability payload' });
		}

		type RawDate = { date?: unknown; startTime?: unknown; endTime?: unknown };
		type RawEntry = { volunteerId?: unknown; dates?: RawDate[] };
		const asAny = raw as { entries?: RawEntry[] };
		const cleaned = {
			month,
			entries: (asAny.entries ?? [])
				.map((e) => {
					const volunteerId = String(e.volunteerId ?? '');
					const dates = (e.dates ?? [])
						.map((d) => {
							const date = String(d.date ?? '').trim();
							if (!DateYYYYMMDD.safeParse(date).success) return null;
							if (!date.startsWith(month + '-')) return null;
							const st = d.startTime != null ? String(d.startTime).trim() : '';
							const et = d.endTime != null ? String(d.endTime).trim() : '';
							const out: { date: string; startTime?: string; endTime?: string } = { date };
							if (st && TimeHHMM.safeParse(st).success) out.startTime = st;
							if (et && TimeHHMM.safeParse(et).success) out.endTime = et;
							return out;
						})
						.filter(
							(d): d is { date: string; startTime?: string; endTime?: string } => d !== null
						);
					return { volunteerId, dates };
				})
				.filter((e) => e.volunteerId && e.dates.length > 0)
		};

		const result = UnavailabilityFile.safeParse(cleaned);
		if (!result.success) {
			return fail(400, { error: result.error.issues[0]?.message ?? 'Invalid data' });
		}

		const config = await loadAppConfig();
		const volIds = new Set(config.volunteers.map((v) => v.id));
		for (const e of result.data.entries) {
			if (!volIds.has(e.volunteerId)) {
				return fail(400, { error: `Unknown volunteer '${e.volunteerId}'` });
			}
		}

		await writeYaml(`unavailability/${month}.yaml`, UnavailabilityFile, result.data);
		redirect(303, `/schedule/${month}?tab=unavailability`);
	},

	/**
	 * Toggle the `confirmed` flag on a single assignment inline from the schedule
	 * table — saves an extra navigation to the assign-editor just to flip one
	 * checkbox. Works for both weekly shifts and event shifts; the form payload
	 * carries the ref kind plus the identifying tuple.
	 *
	 * For weekly shifts where no assignment row exists yet, we synthesize an
	 * empty one so the confirmed flag has somewhere to land (matches the
	 * behaviour of the assign-editor).
	 */
	toggleConfirmed: async ({ request, params }) => {
		const monthParsed = MonthYYYYMM.safeParse(params.month);
		if (!monthParsed.success) return fail(400, { error: 'Invalid month' });
		const month = monthParsed.data;

		const form = await request.formData();
		const kind = String(form.get('kind') ?? '');
		const churchId = String(form.get('churchId') ?? '');
		const shiftId = String(form.get('shiftId') ?? '');

		const config = await loadAppConfig();
		const church = config.churches.find((c) => c.id === churchId);
		if (!church) return fail(404, { error: `Church '${churchId}' not found` });
		const shift = church.weeklyShifts.find((s) => s.id === shiftId);

		if (kind === 'weekly') {
			const dateStr = String(form.get('date') ?? '');
			const date = DateYYYYMMDD.safeParse(dateStr);
			if (!date.success) return fail(400, { error: 'Invalid date' });
			if (!shift) return fail(404, { error: `Shift '${shiftId}' not found` });

			const schedulePath = `schedules/${month}.yaml`;
			const schedule = (await exists(schedulePath))
				? await readYaml(schedulePath, MonthlySchedule)
				: { month, weekOverrides: {}, assignments: [] };

			const assignmentId = weeklyAssignmentId(date.data, churchId, shiftId);
			const idx = schedule.assignments.findIndex((a) => a.id === assignmentId);
			if (idx === -1) {
				schedule.assignments.push({
					id: assignmentId,
					date: date.data,
					churchId,
					shiftId,
					serviceIds: shift.serviceIds,
					volunteerIds: [],
					hoursCounted: computeShiftHours(church.weeklyServices, shift.serviceIds),
					confirmed: true,
					notes: ''
				});
			} else {
				schedule.assignments[idx] = {
					...schedule.assignments[idx],
					confirmed: !schedule.assignments[idx].confirmed
				};
			}

			schedule.assignments.sort((a, b) => {
				if (a.date !== b.date) return a.date.localeCompare(b.date);
				if (a.churchId !== b.churchId) return a.churchId.localeCompare(b.churchId);
				return a.shiftId.localeCompare(b.shiftId);
			});
			await writeYaml(schedulePath, MonthlySchedule, schedule);
			redirect(303, `/schedule/${month}`);
		} else if (kind === 'event') {
			const eventId = String(form.get('eventId') ?? '');
			if (!eventId) return fail(400, { error: 'Missing eventId' });

			const prefix = month + '-';
			const files = (await exists('events'))
				? (await readdir(join(DATA_DIR, 'events'))).filter(
						(f) => f.startsWith(prefix) && f.endsWith('.yaml')
					)
				: [];
			let targetFile: string | null = null;
			let event: EventFile | null = null;
			for (const f of files) {
				const ev = await readYaml(`events/${f}`, EventFile);
				if (ev.id === eventId) {
					targetFile = f;
					event = ev;
					break;
				}
			}
			if (!event || !targetFile) return fail(404, { error: `Event '${eventId}' not found` });

			const block = event.churches.find((b) => b.churchId === churchId);
			if (!block) return fail(404, { error: `Church '${churchId}' not in event` });
			const evShift = block.shifts.find((s) => s.id === shiftId);
			if (!evShift) return fail(404, { error: `Shift '${shiftId}' not in event/church block` });

			const aIdx = block.assignments.findIndex((a) => a.shiftId === shiftId);
			if (aIdx === -1) {
				block.assignments.push({
					id: eventAssignmentId(event.id, churchId, shiftId),
					shiftId,
					serviceIds: evShift.serviceIds,
					volunteerIds: [],
					hoursCounted: 0,
					confirmed: true,
					notes: ''
				});
			} else {
				block.assignments[aIdx] = {
					...block.assignments[aIdx],
					confirmed: !block.assignments[aIdx].confirmed
				};
			}
			block.assignments.sort((a, b) => a.shiftId.localeCompare(b.shiftId));
			await writeYaml(`events/${targetFile}`, EventFile, event);
			redirect(303, `/schedule/${month}`);
		} else {
			return fail(400, { error: `Invalid kind '${kind}'` });
		}
	}
};
