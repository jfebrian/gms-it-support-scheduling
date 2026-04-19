import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { error, fail, redirect } from '@sveltejs/kit';
import { DATA_DIR, exists, loadAppConfig, readYaml, writeYaml } from '$lib/storage';
import { EventFile, MonthYYYYMM, UnavailabilityFile } from '$lib/schemas';
import {
	classifyVolunteersForDate,
	computeShiftHours,
	eventAssignmentId,
	resolveEventServices
} from '$lib/assignmentHelpers';
import type { Actions, PageServerLoad } from './$types';

/** Find the event file whose parsed contents have id === eventId. */
async function findEventPath(eventId: string, month: string): Promise<string | null> {
	if (!(await exists('events'))) return null;
	const prefix = month + '-';
	const files = (await readdir(join(DATA_DIR, 'events'))).filter(
		(f) => f.startsWith(prefix) && f.endsWith('.yaml')
	);
	for (const f of files) {
		const ev = await readYaml(`events/${f}`, EventFile);
		if (ev.id === eventId) return `events/${f}`;
	}
	return null;
}

export const load: PageServerLoad = async ({ params }) => {
	const month = MonthYYYYMM.safeParse(params.month);
	if (!month.success) error(400, 'Invalid month');

	const path = await findEventPath(params.eventId, month.data);
	if (!path) error(404, `Event '${params.eventId}' not found in ${month.data}`);
	const event = await readYaml(path, EventFile);

	const config = await loadAppConfig();

	const unavailability = (await exists(`unavailability/${month.data}.yaml`))
		? await readYaml(`unavailability/${month.data}.yaml`, UnavailabilityFile)
		: null;

	// Resolve each church block — fill in default services when the block didn't
	// override them, and pre-classify volunteers for the event date+church.
	const blocks = event.churches.map((block) => {
		const church = config.churches.find((c) => c.id === block.churchId);
		if (!church) error(500, `Event references unknown church '${block.churchId}'`);
		const services = resolveEventServices(church, block);
		const classified = classifyVolunteersForDate(
			config,
			block.churchId,
			event.date,
			unavailability
		);
		return { block, church, services, classified };
	});

	return {
		month: month.data,
		event,
		eventPath: path,
		blocks
	};
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const month = MonthYYYYMM.parse(params.month);
		const path = await findEventPath(params.eventId, month);
		if (!path) return fail(404, { error: 'Event not found' });
		const event = await readYaml(path, EventFile);

		const form = await request.formData();
		const payload = String(form.get('payload') ?? '');
		let raw: unknown;
		try {
			raw = JSON.parse(payload);
		} catch {
			return fail(400, { error: 'Invalid payload' });
		}

		// Payload: [{ churchId, shifts: [{ shiftId, volunteerIds, notes, confirmed }] }, ...]
		const entries = raw as Array<{
			churchId: string;
			shifts: Array<{
				shiftId: string;
				volunteerIds: string[];
				notes: string;
				confirmed: boolean;
			}>;
		}>;
		if (!Array.isArray(entries)) return fail(400, { error: 'Invalid payload shape' });

		const config = await loadAppConfig();
		const volIds = new Set(config.volunteers.map((v) => v.id));

		// Rebuild each block's assignments from the submitted payload.
		const updatedBlocks = event.churches.map((block) => {
			const submission = entries.find((e) => e.churchId === block.churchId);
			if (!submission) return block;

			const church = config.churches.find((c) => c.id === block.churchId);
			if (!church) throw fail(500, { error: `Unknown church '${block.churchId}'` });
			const services = resolveEventServices(church, block);

			const assignmentsById = new Map(block.assignments.map((a) => [a.shiftId, a]));
			for (const e of submission.shifts) {
				const shift = block.shifts.find((s) => s.id === e.shiftId);
				if (!shift) throw fail(400, { error: `Unknown shiftId '${e.shiftId}'` });
				for (const vid of e.volunteerIds) {
					if (!volIds.has(vid)) throw fail(400, { error: `Unknown volunteer '${vid}'` });
				}
				assignmentsById.set(e.shiftId, {
					id: eventAssignmentId(event.id, block.churchId, shift.id),
					shiftId: shift.id,
					serviceIds: shift.serviceIds,
					volunteerIds: e.volunteerIds,
					hoursCounted: computeShiftHours(services, shift.serviceIds),
					confirmed: Boolean(e.confirmed),
					notes: String(e.notes ?? '')
				});
			}

			return {
				...block,
				assignments: Array.from(assignmentsById.values()).sort((a, b) =>
					a.shiftId.localeCompare(b.shiftId)
				)
			};
		});

		const updated = { ...event, churches: updatedBlocks };

		const parsed = EventFile.safeParse(updated);
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Invalid event after edit'
			});
		}

		await writeYaml(path, EventFile, parsed.data);
		redirect(303, `/schedule/${month}`);
	}
};
