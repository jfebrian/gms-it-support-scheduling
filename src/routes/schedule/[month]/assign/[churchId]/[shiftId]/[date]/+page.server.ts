import { error, fail, redirect } from '@sveltejs/kit';
import { exists, loadAppConfig, readYaml, writeYaml } from '$lib/storage';
import {
	Assignment,
	DateYYYYMMDD,
	IdString,
	MonthYYYYMM,
	MonthlySchedule,
	UnavailabilityFile
} from '$lib/schemas';
import { classifyVolunteersForDate, computeShiftHours, weeklyAssignmentId } from '$lib/assignmentHelpers';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const month = MonthYYYYMM.safeParse(params.month);
	const churchId = IdString.safeParse(params.churchId);
	const shiftId = IdString.safeParse(params.shiftId);
	const date = DateYYYYMMDD.safeParse(params.date);
	if (!month.success) error(400, 'Invalid month');
	if (!churchId.success) error(400, 'Invalid churchId');
	if (!shiftId.success) error(400, 'Invalid shiftId');
	if (!date.success) error(400, 'Invalid date');
	if (!date.data.startsWith(month.data + '-')) error(400, 'Date must be within month');

	const config = await loadAppConfig();
	const church = config.churches.find((c) => c.id === churchId.data);
	if (!church) error(404, `Church '${churchId.data}' not found`);
	const shift = church.weeklyShifts.find((s) => s.id === shiftId.data);
	if (!shift) error(404, `Shift '${shiftId.data}' not found in church '${church.id}'`);

	const schedulePath = `schedules/${month.data}.yaml`;
	const schedule = (await exists(schedulePath))
		? await readYaml(schedulePath, MonthlySchedule)
		: { month: month.data, weekOverrides: {}, assignments: [] };

	const assignmentId = weeklyAssignmentId(date.data, churchId.data, shiftId.data);
	const current = schedule.assignments.find((a) => a.id === assignmentId);

	const unavailability = (await exists(`unavailability/${month.data}.yaml`))
		? await readYaml(`unavailability/${month.data}.yaml`, UnavailabilityFile)
		: null;

	const classified = classifyVolunteersForDate(
		config,
		churchId.data,
		date.data,
		unavailability
	);

	return {
		month: month.data,
		date: date.data,
		church,
		shift,
		current,
		classified
	};
};

export const actions: Actions = {
	default: async ({ request, params }) => {
		const month = MonthYYYYMM.parse(params.month);
		const churchId = IdString.parse(params.churchId);
		const shiftId = IdString.parse(params.shiftId);
		const date = DateYYYYMMDD.parse(params.date);

		const form = await request.formData();
		const volunteerIds = form
			.getAll('volunteerIds')
			.map((v) => String(v).trim())
			.filter(Boolean);
		const notes = String(form.get('notes') ?? '').trim();
		const confirmed = form.get('confirmed') === 'on';

		const config = await loadAppConfig();
		const church = config.churches.find((c) => c.id === churchId)!;
		const shift = church.weeklyShifts.find((s) => s.id === shiftId)!;

		// Validate volunteer IDs exist.
		const volIds = new Set(config.volunteers.map((v) => v.id));
		for (const id of volunteerIds) {
			if (!volIds.has(id)) return fail(400, { error: `Unknown volunteer '${id}'` });
		}

		const candidate = {
			id: weeklyAssignmentId(date, churchId, shiftId),
			date,
			churchId,
			shiftId,
			serviceIds: shift.serviceIds,
			volunteerIds,
			hoursCounted: computeShiftHours(church.weeklyServices, shift.serviceIds),
			confirmed,
			notes
		};
		const parsed = Assignment.safeParse(candidate);
		if (!parsed.success) {
			return fail(400, {
				error: parsed.error.issues[0]?.message ?? 'Invalid assignment'
			});
		}

		const schedulePath = `schedules/${month}.yaml`;
		const schedule = (await exists(schedulePath))
			? await readYaml(schedulePath, MonthlySchedule)
			: { month, weekOverrides: {}, assignments: [] };

		const idx = schedule.assignments.findIndex((a) => a.id === parsed.data.id);
		if (idx === -1) schedule.assignments.push(parsed.data);
		else schedule.assignments[idx] = parsed.data;

		// Sort for stable diffs.
		schedule.assignments.sort((a, b) => {
			if (a.date !== b.date) return a.date.localeCompare(b.date);
			if (a.churchId !== b.churchId) return a.churchId.localeCompare(b.churchId);
			return a.shiftId.localeCompare(b.shiftId);
		});

		await writeYaml(schedulePath, MonthlySchedule, schedule);
		redirect(303, `/schedule/${month}`);
	}
};
