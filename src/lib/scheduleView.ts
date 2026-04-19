/**
 * Build the per-church, grouped schedule view used by /schedule/[month].
 *
 * Layout goal (mirrors the paper "JADWAL IT SUPPORT" sheet):
 *
 *   ┌──────────────────── GMS Central Park ────────────────────┐
 *   │ Tanggal Ibadah        │ Ibadah     │ Volunteer            │
 *   │                       │ Umum 1     │                      │
 *   │ Ibadah Jumat Agung... │ Umum 2     │  (volunteer A —      │
 *   │ 3 April 2026          │ Umum 3     │   rowspan over the   │
 *   │                       │ Umum 4     │   whole shift's svcs)│
 *   │                       │ Umum 5     │                      │
 *   │                       │ ...        │  (volunteer B ...)   │
 *   ├───────────────────────┼────────────┼──────────────────────┤
 *   │ Ibadah Awal Bulan     │ AOG        │ (vol A)              │
 *   │ AOG 4 April 2026      │ Umum 1     │                      │
 *   │ Umum 5 April 2026     │ Umum 2     │ (vol B — rowspan 4)  │
 *   │                       │ ...        │                      │
 *
 * Each church groups rows by service-weekend:
 *   - Events that fall in the month become their own group.
 *   - The first Sunday ≤ day 7 is labelled "Ibadah Awal Bulan".
 *   - Subsequent Sundays are labelled "Ibadah Mingguan".
 *
 * Within a group, each weekly/event shift contributes N "display items" —
 * one per distinct display label (aog-teen/aog-youth collapse to one "AOG",
 * umum-1/umum-2/... stay separate). Those display items become the rows
 * of the middle column; the Volunteer cell uses rowspan to span all display
 * items of a single shift (since one volunteer covers the whole shift).
 *
 * The first column ("Tanggal Ibadah") rowspans the entire group and carries
 * the group title plus one or more date lines — collapsed if every service
 * lands on the same calendar date, otherwise prefixed with the display kind
 * (AOG / Umum) so the user can see AOG is Saturday while Umum is Sunday.
 */

import type {
	Assignment,
	Church,
	EventFile,
	MonthlySchedule,
	EventChurchBlock
} from './schemas';
import { datesInMonthMatchingDow, toIsoDate } from './dates';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DisplayKind = 'AOG' | 'Umum' | 'Other';

export type DisplayItem = {
	/** What shows in the "Ibadah" column, e.g. "AOG", "Umum 1". */
	label: string;
	kind: DisplayKind;
	/** The underlying service ID(s) that this row represents. */
	serviceIds: string[];
	/**
	 * Earliest start time across the underlying services, rendered as a small
	 * sub-label under the Ibadah label (e.g. "09:00"). `null` if not known.
	 */
	startTime: string | null;
};

export type ShiftBlock = {
	/** Stable key for {#each} (e.g. `weekly:2026-04-05:shift-u1-u4`). */
	key: string;
	/** Shift label shown on hover/for debug (not currently rendered inline). */
	shiftLabel: string;
	displayItems: DisplayItem[];
	volunteerIds: string[];
	unassigned: boolean;
	/** Where the "click to edit" link should go. */
	editHref: string;
	notes: string;
	/** Whether the assignment is confirmed (locked from the randomizer). */
	confirmed: boolean;
	/**
	 * Identifying tuple for the inline "confirmed" checkbox on the schedule
	 * page — lets the toggle action locate the exact assignment without
	 * re-parsing the shift key.
	 */
	confirmRef:
		| { kind: 'weekly'; churchId: string; shiftId: string; date: string }
		| { kind: 'event'; eventId: string; churchId: string; shiftId: string };
};

export type GroupKind = 'event' | 'awal-bulan' | 'mingguan';

export type ScheduleGroup = {
	kind: GroupKind;
	title: string;
	/** One or more rendered date lines, e.g. ["AOG 4 April 2026", "Umum 5 April 2026"]. */
	dateLines: string[];
	shiftBlocks: ShiftBlock[];
};

export type ChurchView = {
	church: Church;
	groups: ScheduleGroup[];
};

// ---------------------------------------------------------------------------
// Display-label helpers
// ---------------------------------------------------------------------------

/**
 * Map a service id to its display label + kind. Rules:
 *   - `aog*`  → "AOG" (AOG)
 *   - `umum-N` or `umum-N-suffix` → "Umum N" (Umum)
 *   - everything else falls back to the id itself (Other).
 *
 * Optional `serviceName` lets us show a prettier label if the id doesn't
 * match the known patterns.
 */
function displayGroupOf(serviceId: string, serviceName?: string): { label: string; kind: DisplayKind } {
	if (serviceId === 'aog' || serviceId.startsWith('aog-')) {
		return { label: 'AOG', kind: 'AOG' };
	}
	const umumMatch = serviceId.match(/^umum-(\d+)/);
	if (umumMatch) {
		return { label: `Umum ${umumMatch[1]}`, kind: 'Umum' };
	}
	return { label: serviceName ?? serviceId, kind: 'Other' };
}

/**
 * Collapse a shift's serviceIds into distinct display items.
 * Consecutive services with the same label are merged (so aog-teen + aog-youth
 * become one "AOG" row); everything else contributes one row per unique label.
 *
 * `startTimeById` lets us stamp each item with the earliest start-time across
 * the merged services, so the Svelte template can render "Umum 1 · 09:00".
 */
function buildDisplayItems(
	serviceIds: readonly string[],
	nameById: Map<string, string>,
	startTimeById: Map<string, string>
): DisplayItem[] {
	const out: DisplayItem[] = [];
	for (const sid of serviceIds) {
		const { label, kind } = displayGroupOf(sid, nameById.get(sid));
		const start = startTimeById.get(sid) ?? null;
		const prev = out.length > 0 ? out[out.length - 1] : null;
		if (prev && prev.label === label) {
			prev.serviceIds.push(sid);
			// Keep the earliest known start time across merged services.
			if (start && (!prev.startTime || start < prev.startTime)) {
				prev.startTime = start;
			}
		} else {
			out.push({ label, kind, serviceIds: [sid], startTime: start });
		}
	}
	return out;
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** "2026-04-05" → "5 April 2026". */
function formatLongDate(iso: string, locale = 'en-GB'): string {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(y, m - 1, d).toLocaleDateString(locale, {
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
}

/** Saturday ISO date for the week ending on the given Sunday ISO. */
function saturdayBefore(sundayIso: string): string {
	const [y, m, d] = sundayIso.split('-').map(Number);
	const dt = new Date(y, m - 1, d);
	dt.setDate(dt.getDate() - 1);
	return toIsoDate(dt);
}

/**
 * Build date lines for a group. `items` is one entry per distinct service used,
 * with its kind and the calendar date it falls on.
 *   - If every service shares the same date → a single line like "5 April 2026".
 *   - Otherwise → one line per (kind, date), prefixed with the kind label.
 */
function buildDateLines(items: ReadonlyArray<{ kind: DisplayKind; date: string }>): string[] {
	if (items.length === 0) return [];
	const uniqueDates = new Set(items.map((i) => i.date));
	if (uniqueDates.size === 1) {
		return [formatLongDate(items[0].date)];
	}
	// Preserve chronological order, deduped by (kind, date).
	const seen = new Set<string>();
	const ordered: Array<{ kind: DisplayKind; date: string }> = [];
	for (const it of items) {
		const key = `${it.kind}|${it.date}`;
		if (!seen.has(key)) {
			seen.add(key);
			ordered.push(it);
		}
	}
	ordered.sort((a, b) => a.date.localeCompare(b.date));
	// Collapse "AOG" and "Umum" groups — if every Umum service is on the same
	// Sunday we want "Umum 5 April 2026", not one line per umum-N.
	const byKindDate = new Map<string, { kind: DisplayKind; date: string }>();
	for (const it of ordered) {
		byKindDate.set(`${it.kind}|${it.date}`, it);
	}
	return Array.from(byKindDate.values()).map(
		(it) => `${it.kind === 'Other' ? '' : it.kind + ' '}${formatLongDate(it.date)}`.trim()
	);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Assemble a ChurchView[] for the given month. The shape is ready for a
 * straight render — no further computation needed inside the Svelte template.
 */
export function buildScheduleView(
	month: string,
	churches: readonly Church[],
	schedule: MonthlySchedule | null,
	events: readonly EventFile[]
): ChurchView[] {
	// Sundays in the month, in order.
	const sundays = datesInMonthMatchingDow(month, 0).map(toIsoDate);
	const firstSunday = sundays[0];
	const isAwalBulan = (iso: string) => {
		if (iso !== firstSunday) return false;
		const day = Number(iso.split('-')[2]);
		return day <= 7;
	};

	// Index weekly assignments: churchId → date → shiftId → Assignment.
	const weeklyByChurch = new Map<string, Map<string, Map<string, Assignment>>>();
	if (schedule) {
		for (const a of schedule.assignments) {
			if (!weeklyByChurch.has(a.churchId)) weeklyByChurch.set(a.churchId, new Map());
			const byDate = weeklyByChurch.get(a.churchId)!;
			if (!byDate.has(a.date)) byDate.set(a.date, new Map());
			byDate.get(a.date)!.set(a.shiftId, a);
		}
	}

	// Events in this month, sorted.
	const sortedEvents = [...events].sort((a, b) => a.date.localeCompare(b.date));

	return churches.map((church) => {
		const nameById = new Map(church.weeklyServices.map((s) => [s.id, s.name]));
		const dowById = new Map(church.weeklyServices.map((s) => [s.id, s.dayOfWeek]));
		const startTimeById = new Map(
			church.weeklyServices.map((s) => [s.id, s.startTime])
		);
		const groups: ScheduleGroup[] = [];

		// ---- Event groups (in chronological order) ----
		for (const ev of sortedEvents) {
			const block = ev.churches.find((b) => b.churchId === church.id);
			if (!block || block.shifts.length === 0) continue;
			groups.push(buildEventGroup(month, church, ev, block));
		}

		// ---- Weekly groups, only if this church has weekly IT shifts ----
		if (church.weeklyShifts.length > 0) {
			for (let i = 0; i < sundays.length; i++) {
				const sundayIso = sundays[i];
				groups.push(
					buildWeeklyGroup(
						month,
						church,
						sundayIso,
						i + 1, // 1-indexed occurrence for shift.weeks filtering
						isAwalBulan(sundayIso),
						weeklyByChurch.get(church.id) ?? new Map(),
						nameById,
						dowById,
						startTimeById
					)
				);
			}
		}

		return { church, groups };
	});
}

// ---------------------------------------------------------------------------
// Weekly group builder
// ---------------------------------------------------------------------------

function buildWeeklyGroup(
	month: string,
	church: Church,
	sundayIso: string,
	weekIdx: number,
	awalBulan: boolean,
	byDate: Map<string, Map<string, Assignment>>,
	nameById: Map<string, string>,
	dowById: Map<string, string>,
	startTimeById: Map<string, string>
): ScheduleGroup {
	const saturdayIso = saturdayBefore(sundayIso);
	const shiftBlocks: ShiftBlock[] = [];
	const dateItems: Array<{ kind: DisplayKind; date: string }> = [];

	for (const shift of church.weeklyShifts) {
		// Skip shifts pinned to other weeks (empty/absent `weeks` = every week).
		if (shift.weeks && shift.weeks.length > 0 && !shift.weeks.includes(weekIdx as 1 | 2 | 3 | 4 | 5)) {
			continue;
		}
		// A shift never spans Sat + Sun in this data model (per churches.yaml
		// preamble), so we can pick the date from any of its services.
		const firstDow = dowById.get(shift.serviceIds[0]) ?? 'sun';
		const dateIso = firstDow === 'sat' ? saturdayIso : sundayIso;
		const displayItems = buildDisplayItems(shift.serviceIds, nameById, startTimeById);
		const asg = byDate.get(dateIso)?.get(shift.id);
		shiftBlocks.push({
			key: `weekly:${dateIso}:${shift.id}`,
			shiftLabel: shift.label ?? shift.id,
			displayItems,
			volunteerIds: asg?.volunteerIds ?? [],
			unassigned: !asg || asg.volunteerIds.length === 0,
			editHref: `/schedule/${month}/assign/${church.id}/${shift.id}/${dateIso}`,
			notes: asg?.notes ?? '',
			confirmed: asg?.confirmed ?? false,
			confirmRef: {
				kind: 'weekly',
				churchId: church.id,
				shiftId: shift.id,
				date: dateIso
			}
		});
		for (const di of displayItems) {
			dateItems.push({ kind: di.kind, date: dateIso });
		}
	}

	// Weekly groups carry an Indonesian-language title so the printed/exported
	// schedule reads naturally to GMS volunteers. First Sunday of the month is
	// "Ibadah Awal Bulan"; every subsequent weekend is "Ibadah Mingguan".
	return {
		kind: awalBulan ? 'awal-bulan' : 'mingguan',
		title: awalBulan ? 'Ibadah Awal Bulan' : 'Ibadah Mingguan',
		dateLines: buildDateLines(dateItems),
		shiftBlocks
	};
}

// ---------------------------------------------------------------------------
// Event group builder
// ---------------------------------------------------------------------------

function buildEventGroup(
	month: string,
	church: Church,
	ev: EventFile,
	block: EventChurchBlock
): ScheduleGroup {
	// Resolve event services — defaulted to the church's weekly Sunday services
	// that require IT Support when block.services is empty. Mirrors the behaviour
	// of $lib/assignmentHelpers.resolveEventServices (kept inline to avoid a cycle).
	const services =
		block.services.length > 0
			? block.services
			: church.weeklyServices
					.filter((s) => s.dayOfWeek === 'sun' && s.requiresItSupport)
					.map(({ id, startTime, name, requiresItSupport }) => ({
						id,
						startTime,
						name,
						requiresItSupport
					}));
	const nameById = new Map(services.map((s) => [s.id, s.name]));
	const startTimeById = new Map(services.map((s) => [s.id, s.startTime]));

	const shiftBlocks: ShiftBlock[] = [];
	const dateItems: Array<{ kind: DisplayKind; date: string }> = [];
	for (const shift of block.shifts) {
		const displayItems = buildDisplayItems(shift.serviceIds, nameById, startTimeById);
		const asg = block.assignments.find((a) => a.shiftId === shift.id);
		shiftBlocks.push({
			key: `event:${ev.id}:${church.id}:${shift.id}`,
			shiftLabel: shift.label ?? shift.id,
			displayItems,
			volunteerIds: asg?.volunteerIds ?? [],
			unassigned: !asg || asg.volunteerIds.length === 0,
			editHref: `/schedule/${month}/events/${ev.id}`,
			notes: asg?.notes ?? '',
			confirmed: asg?.confirmed ?? false,
			confirmRef: {
				kind: 'event',
				eventId: ev.id,
				churchId: church.id,
				shiftId: shift.id
			}
		});
		for (const di of displayItems) {
			dateItems.push({ kind: di.kind, date: ev.date });
		}
	}

	// Tag livestream churches so Joanda can tell at a glance which site is
	// broadcasting. Event names are already user-supplied (e.g. "Ibadah Jumat
	// Agung 2026"), so we don't prefix "Ibadah" ourselves.
	const livestreamSuffix = church.livestream ? ' (Livestreaming)' : '';
	return {
		kind: 'event',
		title: `${ev.name}${livestreamSuffix}`,
		dateLines: buildDateLines(dateItems),
		shiftBlocks
	};
}

