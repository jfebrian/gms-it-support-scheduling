/**
 * Randomized scheduler — the "Populate" button.
 *
 * Goal: fill every non-confirmed assignment in a month (weekly shifts +
 * event-church-block shifts) while respecting, in priority order:
 *
 *   1. Hard filters:
 *      - Volunteer must be active, have the church in `assignableChurchIds`,
 *        and not be weekly/specifically unavailable during the shift's time
 *        window.
 *      - No same-date overlap (can't stack two shifts on the same day).
 *      - ONE SHIFT PER WEEK across ALL churches and events (Joanda rule —
 *        a volunteer never serves twice in a calendar week). The week is
 *        anchored on the Sunday of that shift's date.
 *   2. Fairness score (lower = preferred), mixing:
 *      - Hours already assigned THIS month (primary).
 *      - Shift count this month (secondary).
 *      - Previous-6-months rolling shift count — so someone who's served
 *        the last 5 months in a row gets nudged behind someone who
 *        hasn't served at all.
 *      - Home-church bonus (small nudge for home church).
 *      - Random jitter so ties don't always go the same way.
 *   3. At-least-one-shift-per-month guarantee. After the greedy pass, any
 *      active volunteer with zero shifts is swapped into a slot they're
 *      eligible for, displacing the volunteer with the most shifts on
 *      that slot.
 *
 * Confirmed assignments are never overwritten but DO count toward hours
 * + shift count + busy-week + busy-date so the scheduler schedules around
 * them fairly.
 *
 * Shifts are processed in chronological order (date asc, then start time),
 * which matches how GMS fills a month in practice.
 */

import {
	SERVICE_DURATION_MIN,
	type Assignment,
	type EventAssignment,
	type EventChurchBlock,
	type EventFile,
	type EventService,
	type MonthlySchedule,
	type ServiceTemplate,
	type ShiftTemplate,
	type EventShift,
	type UnavailabilityFile,
	type Volunteer
} from './schemas';
import type { AppConfig } from './storage';
import {
	computeShiftHours,
	eventAssignmentId,
	resolveEventServices,
	weeklyAssignmentId
} from './assignmentHelpers';
import { datesInMonthMatchingDow, toIsoDate } from './dates';

type AnyService = Pick<ServiceTemplate | EventService, 'id' | 'startTime'>;
type AnyShift = Pick<ShiftTemplate | EventShift, 'id' | 'serviceIds' | 'requiredVolunteers'>;

/** Minute-of-day for an `HH:MM` string. */
function hhmmToMin(t: string): number {
	const [h, m] = t.split(':').map(Number);
	return h * 60 + m;
}

function timeRangeOf(
	shift: AnyShift,
	services: ReadonlyArray<AnyService>
): { start: number; end: number } | null {
	const byId = new Map(services.map((s) => [s.id, s]));
	let start = Number.POSITIVE_INFINITY;
	let end = Number.NEGATIVE_INFINITY;
	for (const sid of shift.serviceIds) {
		const s = byId.get(sid);
		if (!s) continue;
		const st = hhmmToMin(s.startTime);
		start = Math.min(start, st);
		end = Math.max(end, st + SERVICE_DURATION_MIN);
	}
	if (!isFinite(start) || !isFinite(end)) return null;
	return { start, end };
}

function rangesOverlap(
	a: { start: number; end: number },
	b: { start: number; end: number }
): boolean {
	return a.start < b.end && b.start < a.end;
}

const DAY_INDEX_TO_DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
function dowOf(iso: string): (typeof DAY_INDEX_TO_DOW)[number] {
	const [y, m, d] = iso.split('-').map(Number);
	return DAY_INDEX_TO_DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/**
 * Sunday-anchored week key for a date, e.g. 2026-04-04 (a Saturday) and
 * 2026-04-05 (the following Sunday) both collapse to week "2026-04-05".
 * Used to enforce "one shift per week" across churches + events.
 */
function weekKeyOf(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	const dow = dt.getUTCDay(); // 0 = Sunday
	const daysToSunday = (7 - dow) % 7; // walk FORWARD to the next Sunday (same Sunday if already Sun)
	dt.setUTCDate(dt.getUTCDate() + daysToSunday);
	const yy = dt.getUTCFullYear();
	const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(dt.getUTCDate()).padStart(2, '0');
	return `${yy}-${mm}-${dd}`;
}

/** True if volunteer's weekly + specific rules block the given shift window. */
function isUnavailable(
	v: Volunteer,
	dateIso: string,
	range: { start: number; end: number },
	unavailability: UnavailabilityFile | null
): boolean {
	const dow = dowOf(dateIso);
	for (const w of v.weeklyUnavailability) {
		if (w.dayOfWeek !== dow) continue;
		const wStart = w.startTime ? hhmmToMin(w.startTime) : 0;
		const wEnd = w.endTime ? hhmmToMin(w.endTime) : 24 * 60;
		if (rangesOverlap(range, { start: wStart, end: wEnd })) return true;
	}
	if (unavailability) {
		const entry = unavailability.entries.find((e) => e.volunteerId === v.id);
		const hit = entry?.dates.find((d) => d.date === dateIso);
		if (hit) {
			const hStart = hit.startTime ? hhmmToMin(hit.startTime) : 0;
			const hEnd = hit.endTime ? hhmmToMin(hit.endTime) : 24 * 60;
			if (rangesOverlap(range, { start: hStart, end: hEnd })) return true;
		}
	}
	return false;
}

/** A single slot the scheduler considers. Weekly + event shifts unify under this shape. */
type Slot = {
	kind: 'weekly' | 'event';
	date: string;
	churchId: string;
	shiftId: string;
	requiredVolunteers: number;
	serviceIds: string[];
	hours: number;
	range: { start: number; end: number } | null;
	weekKey: string;
	/** Event-specific: which event file + church block this slot lives in. */
	eventId?: string;
};

/**
 * Result returned by populateMonth. Callers apply the new schedule and the
 * patched event files back to disk.
 */
export type PopulateResult = {
	schedule: MonthlySchedule;
	/** Event id → updated EventFile (same shape as input, assignments rewritten). */
	events: Map<string, EventFile>;
	/** Brief human-readable stats for a flash message. */
	summary: {
		slotsConsidered: number;
		slotsFilled: number;
		slotsKept: number;
		slotsSkippedNoCandidate: number;
		/** # active volunteers who ended up with ≥1 shift after the guarantee pass. */
		volunteersWithShift: number;
		/** # active volunteers who remained at 0 shifts because no eligible slot existed. */
		volunteersStillZero: number;
	};
};

/**
 * Per-volunteer roll-up from prior months. The scheduler only cares about
 * shift count here — hours aren't comparable cross-month because service
 * durations might shift under us.
 */
export type VolunteerHistory = {
	/** volunteerId → total shifts served in the look-back window. */
	shiftCountByVolunteer: Map<string, number>;
	/** How many months of history this covers (0..6). */
	monthsCovered: number;
};

/**
 * Convenience builder: pass prior months' schedule+events and get a
 * VolunteerHistory ready to feed into populateMonth.
 */
export function summarizeHistory(
	months: ReadonlyArray<{
		schedule: MonthlySchedule | null;
		events: readonly EventFile[];
	}>
): VolunteerHistory {
	const shiftCountByVolunteer = new Map<string, number>();
	const bump = (vid: string, by = 1) => {
		shiftCountByVolunteer.set(vid, (shiftCountByVolunteer.get(vid) ?? 0) + by);
	};
	let monthsCovered = 0;
	for (const m of months) {
		let touched = false;
		if (m.schedule) {
			for (const a of m.schedule.assignments) {
				for (const vid of a.volunteerIds) bump(vid);
				if (a.volunteerIds.length > 0) touched = true;
			}
		}
		for (const ev of m.events) {
			for (const block of ev.churches) {
				for (const a of block.assignments) {
					for (const vid of a.volunteerIds) bump(vid);
					if (a.volunteerIds.length > 0) touched = true;
				}
			}
		}
		if (touched) monthsCovered++;
	}
	return { shiftCountByVolunteer, monthsCovered };
}

/**
 * Deterministically-seeded LCG. Two pops back-to-back give different output
 * (we mix the time into the seed) but within one run the iteration order is
 * stable across candidates — the scheduler's choices are reproducible for a
 * given seed, which makes re-running with a fixed seed useful for tests.
 */
function makeRandom(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 0xffffffff;
	};
}

/**
 * Core randomizer. Pure function: takes the current month state and returns a
 * new schedule + event files with non-confirmed slots filled. Confirmed slots
 * are carried through unchanged.
 */
export function populateMonth(args: {
	config: AppConfig;
	month: string;
	schedule: MonthlySchedule | null;
	events: readonly EventFile[];
	unavailability: UnavailabilityFile | null;
	/** Prior-months roll-up used for long-term fairness. Optional (empty = no history). */
	history?: VolunteerHistory;
	/** Seed for the tie-break shuffle. Defaults to `Date.now()`. */
	seed?: number;
}): PopulateResult {
	const { config, month, schedule, events, unavailability } = args;
	const history = args.history ?? { shiftCountByVolunteer: new Map(), monthsCovered: 0 };
	const seed = args.seed ?? Date.now();
	const rand = makeRandom(seed);

	const churchById = new Map(config.churches.map((c) => [c.id, c]));
	const volunteerById = new Map(config.volunteers.map((v) => [v.id, v]));

	// ---- Gather slots ---------------------------------------------------------

	// Clone schedule (and initialize a blank one if none exists yet so we have
	// somewhere to write assignments into).
	const nextSchedule: MonthlySchedule = schedule
		? JSON.parse(JSON.stringify(schedule))
		: { month, weekOverrides: {}, assignments: [] };
	const weeklyByKey = new Map<string, Assignment>(
		nextSchedule.assignments.map((a) => [weeklyAssignmentId(a.date, a.churchId, a.shiftId), a])
	);

	const nextEvents = new Map<string, EventFile>();
	for (const ev of events) {
		nextEvents.set(ev.id, JSON.parse(JSON.stringify(ev)) as EventFile);
	}

	const slots: Slot[] = [];

	// Weekly slots: for each church, for each Sunday in the month, for each shift,
	// derive the calendar date (Sat or Sun based on first service's dayOfWeek).
	// `shift.weeks` lets a shift restrict itself to specific occurrences in the
	// month (e.g. "first Sunday only"). Empty/absent = every week.
	const sundays = datesInMonthMatchingDow(month, 0).map(toIsoDate);
	for (const church of config.churches) {
		if (church.weeklyShifts.length === 0) continue;
		const svcById = new Map(church.weeklyServices.map((s) => [s.id, s]));
		for (let i = 0; i < sundays.length; i++) {
			const sunday = sundays[i];
			const [sy, sm, sd] = sunday.split('-').map(Number);
			const satDate = new Date(sy, sm - 1, sd - 1);
			const saturday = toIsoDate(satDate);
			const weekIdx = i + 1; // 1-indexed occurrence within the month
			for (const shift of church.weeklyShifts) {
				if (shift.weeks && shift.weeks.length > 0 && !shift.weeks.includes(weekIdx as 1 | 2 | 3 | 4 | 5)) {
					continue;
				}
				const firstSvc = svcById.get(shift.serviceIds[0]);
				if (!firstSvc) continue;
				const dateIso = firstSvc.dayOfWeek === 'sat' ? saturday : sunday;
				const range = timeRangeOf(shift, church.weeklyServices);
				slots.push({
					kind: 'weekly',
					date: dateIso,
					churchId: church.id,
					shiftId: shift.id,
					requiredVolunteers: shift.requiredVolunteers,
					serviceIds: [...shift.serviceIds],
					hours: computeShiftHours(church.weeklyServices, shift.serviceIds),
					range,
					weekKey: weekKeyOf(dateIso)
				});
			}
		}
	}

	// Event slots: one per (event, church block, shift).
	for (const ev of events) {
		for (const block of ev.churches) {
			const church = churchById.get(block.churchId);
			if (!church) continue;
			const services = resolveEventServices(church, block);
			for (const shift of block.shifts) {
				const range = timeRangeOf(shift, services);
				slots.push({
					kind: 'event',
					date: ev.date,
					churchId: block.churchId,
					shiftId: shift.id,
					requiredVolunteers: shift.requiredVolunteers,
					serviceIds: [...shift.serviceIds],
					hours: computeShiftHours(services, shift.serviceIds),
					range,
					weekKey: weekKeyOf(ev.date),
					eventId: ev.id
				});
			}
		}
	}

	// Chronological order: date asc, then start time asc so morning services
	// are scheduled before evening ones (earlier volunteers get a fair draw).
	slots.sort((a, b) => {
		const d = a.date.localeCompare(b.date);
		if (d !== 0) return d;
		const aStart = a.range?.start ?? 0;
		const bStart = b.range?.start ?? 0;
		return aStart - bStart;
	});

	// ---- Track per-volunteer balances ----------------------------------------

	type Balance = {
		hours: number;
		shiftCount: number;
		/** date → list of assigned time ranges (to detect overlaps). */
		busyByDate: Map<string, Array<{ start: number; end: number }>>;
		/** week keys (Sunday ISO) the volunteer is already booked in. */
		busyWeeks: Set<string>;
	};
	const balance = new Map<string, Balance>();
	function balOf(vid: string): Balance {
		let b = balance.get(vid);
		if (!b) {
			b = { hours: 0, shiftCount: 0, busyByDate: new Map(), busyWeeks: new Set() };
			balance.set(vid, b);
		}
		return b;
	}
	function markBusy(
		vid: string,
		date: string,
		range: { start: number; end: number } | null,
		weekKey: string
	) {
		const b = balOf(vid);
		if (range) {
			if (!b.busyByDate.has(date)) b.busyByDate.set(date, []);
			b.busyByDate.get(date)!.push(range);
		}
		b.busyWeeks.add(weekKey);
	}

	// Seed balances with confirmed assignments across the whole month so the
	// fairness score reflects what's already locked in.
	function seedConfirmed(
		date: string,
		churchId: string,
		shiftId: string,
		services: ReadonlyArray<AnyService>,
		shift: AnyShift,
		volunteerIds: ReadonlyArray<string>
	) {
		const hours = computeShiftHours(services, shift.serviceIds);
		const range = timeRangeOf(shift, services);
		const wk = weekKeyOf(date);
		for (const vid of volunteerIds) {
			const b = balOf(vid);
			b.hours += hours;
			b.shiftCount += 1;
			markBusy(vid, date, range, wk);
		}
		void churchId;
		void shiftId;
	}

	// Weekly confirmed
	if (schedule) {
		for (const a of schedule.assignments) {
			if (!a.confirmed || a.volunteerIds.length === 0) continue;
			const ch = churchById.get(a.churchId);
			if (!ch) continue;
			const shift = ch.weeklyShifts.find((s) => s.id === a.shiftId);
			if (!shift) continue;
			seedConfirmed(a.date, a.churchId, a.shiftId, ch.weeklyServices, shift, a.volunteerIds);
		}
	}
	// Event confirmed
	for (const ev of events) {
		for (const block of ev.churches) {
			const church = churchById.get(block.churchId);
			if (!church) continue;
			const services = resolveEventServices(church, block);
			for (const a of block.assignments) {
				if (!a.confirmed || a.volunteerIds.length === 0) continue;
				const shift = block.shifts.find((s) => s.id === a.shiftId);
				if (!shift) continue;
				seedConfirmed(ev.date, block.churchId, a.shiftId, services, shift, a.volunteerIds);
			}
		}
	}

	// ---- Fill slots ----------------------------------------------------------

	let slotsFilled = 0;
	let slotsKept = 0;
	let slotsSkippedNoCandidate = 0;

	/** Which volunteers we picked for each slot (used in the guarantee pass). */
	const picksBySlotIdx = new Map<number, string[]>();

	for (let slotIdx = 0; slotIdx < slots.length; slotIdx++) {
		const slot = slots[slotIdx];
		// Is there an existing confirmed assignment for this slot? Skip if so.
		let existingConfirmed = false;
		let existingVolunteerIds: string[] = [];
		if (slot.kind === 'weekly') {
			const aid = weeklyAssignmentId(slot.date, slot.churchId, slot.shiftId);
			const existing = weeklyByKey.get(aid);
			if (existing?.confirmed) {
				existingConfirmed = true;
				existingVolunteerIds = [...existing.volunteerIds];
				slotsKept++;
			}
		} else {
			const ev = nextEvents.get(slot.eventId!);
			const block = ev?.churches.find((b) => b.churchId === slot.churchId);
			const existing = block?.assignments.find((a) => a.shiftId === slot.shiftId);
			if (existing?.confirmed) {
				existingConfirmed = true;
				existingVolunteerIds = [...existing.volunteerIds];
				slotsKept++;
			}
		}
		if (existingConfirmed) {
			picksBySlotIdx.set(slotIdx, existingVolunteerIds);
			continue;
		}

		const picked = pickForSlot(slot);
		picksBySlotIdx.set(slotIdx, picked.map((v) => v.id));

		if (picked.length === 0) {
			slotsSkippedNoCandidate++;
			applyAssignment(slot, []);
			continue;
		}

		for (const v of picked) {
			const b = balOf(v.id);
			b.hours += slot.hours;
			b.shiftCount += 1;
			markBusy(v.id, slot.date, slot.range, slot.weekKey);
		}

		applyAssignment(
			slot,
			picked.map((v) => v.id)
		);
		if (picked.length > 0) slotsFilled++;
	}

	// ---- At-least-one-shift-per-month guarantee -----------------------------
	//
	// Find active volunteers with zero shifts. For each, walk the slots we
	// filled and look for one where (a) they're eligible, and (b) the least
	// "deserving" currently-picked volunteer has at least 2 shifts so far
	// (otherwise we'd rob Peter to pay Paul). Swap them in.
	//
	// We iterate in reverse chronological order so we nudge the LATEST slot
	// rather than the earliest — earlier shifts already had time to balance
	// and the late ones are more likely to have someone with multiple shifts.

	const activeVolunteers = config.volunteers.filter((v) => v.active);
	for (const v of activeVolunteers) {
		if (balOf(v.id).shiftCount > 0) continue;
		// Walk slots in reverse; swap into the first one where a better swap is possible.
		for (let si = slots.length - 1; si >= 0; si--) {
			const slot = slots[si];
			const picks = picksBySlotIdx.get(si) ?? [];
			if (picks.length === 0) continue;
			// Filter out confirmed slots (can't change them).
			if (isSlotConfirmed(slot)) continue;
			if (!isEligibleForSlot(v, slot)) continue;
			// Find the current pick with the highest shift count >= 2 (don't
			// strip someone who's also barely-assigned — that just shifts the
			// problem). Tie-break by hours.
			let donorIdx = -1;
			let donorShifts = 1;
			let donorHours = 0;
			for (let pi = 0; pi < picks.length; pi++) {
				const pb = balOf(picks[pi]);
				if (pb.shiftCount < 2) continue;
				if (pb.shiftCount > donorShifts || (pb.shiftCount === donorShifts && pb.hours > donorHours)) {
					donorIdx = pi;
					donorShifts = pb.shiftCount;
					donorHours = pb.hours;
				}
			}
			if (donorIdx === -1) continue;
			// Swap: donor loses this slot, v gains it.
			const donorId = picks[donorIdx];
			const donorBal = balOf(donorId);
			donorBal.shiftCount -= 1;
			donorBal.hours = Math.max(0, donorBal.hours - slot.hours);
			// We can't cleanly remove one range from busyByDate — but on a per-day
			// basis leaving a stale range is harmless because the slot is now v's.
			const vBal = balOf(v.id);
			vBal.shiftCount += 1;
			vBal.hours += slot.hours;
			markBusy(v.id, slot.date, slot.range, slot.weekKey);

			const newPicks = [...picks];
			newPicks[donorIdx] = v.id;
			picksBySlotIdx.set(si, newPicks);
			applyAssignment(slot, newPicks);
			break; // this volunteer is done
		}
	}

	let volunteersWithShift = 0;
	let volunteersStillZero = 0;
	for (const v of activeVolunteers) {
		if (balOf(v.id).shiftCount > 0) volunteersWithShift++;
		else volunteersStillZero++;
	}

	// ---- Writer: apply a slot's volunteers back to schedule/event structures ----
	function applyAssignment(slot: Slot, volunteerIds: string[]) {
		if (slot.kind === 'weekly') {
			const aid = weeklyAssignmentId(slot.date, slot.churchId, slot.shiftId);
			const existing = weeklyByKey.get(aid);
			const patched: Assignment = existing
				? { ...existing, volunteerIds, serviceIds: [...slot.serviceIds], hoursCounted: slot.hours }
				: {
						id: aid,
						date: slot.date,
						churchId: slot.churchId,
						shiftId: slot.shiftId,
						serviceIds: [...slot.serviceIds],
						volunteerIds,
						hoursCounted: slot.hours,
						confirmed: false,
						notes: ''
					};
			if (existing) {
				const idx = nextSchedule.assignments.indexOf(existing);
				nextSchedule.assignments[idx] = patched;
			} else {
				nextSchedule.assignments.push(patched);
			}
			weeklyByKey.set(aid, patched);
		} else {
			const ev = nextEvents.get(slot.eventId!);
			if (!ev) return;
			const block: EventChurchBlock | undefined = ev.churches.find(
				(b) => b.churchId === slot.churchId
			);
			if (!block) return;
			const idx = block.assignments.findIndex((a) => a.shiftId === slot.shiftId);
			const aid = eventAssignmentId(slot.eventId!, slot.churchId, slot.shiftId);
			const base: EventAssignment = {
				id: aid,
				shiftId: slot.shiftId,
				serviceIds: [...slot.serviceIds],
				volunteerIds,
				hoursCounted: slot.hours,
				confirmed: idx === -1 ? false : block.assignments[idx].confirmed,
				notes: idx === -1 ? '' : block.assignments[idx].notes
			};
			if (idx === -1) {
				block.assignments.push(base);
			} else {
				block.assignments[idx] = { ...block.assignments[idx], ...base };
			}
		}
	}

	function isSlotConfirmed(slot: Slot): boolean {
		if (slot.kind === 'weekly') {
			const aid = weeklyAssignmentId(slot.date, slot.churchId, slot.shiftId);
			return weeklyByKey.get(aid)?.confirmed === true;
		}
		const ev = nextEvents.get(slot.eventId!);
		const block = ev?.churches.find((b) => b.churchId === slot.churchId);
		return block?.assignments.find((a) => a.shiftId === slot.shiftId)?.confirmed === true;
	}

	function isEligibleForSlot(v: Volunteer, slot: Slot): boolean {
		if (!v.active) return false;
		if (!v.assignableChurchIds.includes(slot.churchId)) return false;
		if (slot.range && isUnavailable(v, slot.date, slot.range, unavailability)) return false;
		if (slot.range) {
			const busy = balOf(v.id).busyByDate.get(slot.date) ?? [];
			if (busy.some((r) => rangesOverlap(r, slot.range!))) return false;
		}
		// Don't break the once-per-week rule in the guarantee pass either —
		// but allow if the busy week is exactly this slot's own week (i.e. they
		// were *just* picked here). In practice the guarantee pass only runs
		// for 0-shift volunteers, so this won't be an issue.
		if (balOf(v.id).busyWeeks.has(slot.weekKey)) return false;
		return true;
	}

	function pickForSlot(slot: Slot): Volunteer[] {
		// Candidate volunteers for this slot.
		const candidates: Volunteer[] = [];
		for (const v of config.volunteers) {
			if (!v.active) continue;
			if (!v.assignableChurchIds.includes(slot.churchId)) continue;
			if (slot.range && isUnavailable(v, slot.date, slot.range, unavailability)) continue;
			// No double-booking on the same date.
			if (slot.range) {
				const busy = balOf(v.id).busyByDate.get(slot.date) ?? [];
				if (busy.some((r) => rangesOverlap(r, slot.range!))) continue;
			}
			// Joanda rule: one shift per calendar week total (across all churches
			// and events). Skip if the volunteer is already booked this week.
			if (balOf(v.id).busyWeeks.has(slot.weekKey)) continue;
			candidates.push(v);
		}

		if (candidates.length === 0) return [];

		// Score each candidate. Lower score = more preferred.
		//
		// Primary: hoursAssigned so far (fairness this month)
		// Secondary: shiftCount this month (tiebreak)
		// Tertiary: previous-6-months shift count (long-term fairness)
		//   - Weight is 0.3 per historical shift — strong enough that a 6-month
		//     gap wins most ties, weak enough that current-month hours still
		//     dominate when there's a big within-month gap.
		// Quaternary: home-church bonus
		// Quinary: random jitter
		const histWeight = 0.3;
		const scored = candidates.map((v) => {
			const b = balOf(v.id);
			const hist = history.shiftCountByVolunteer.get(v.id) ?? 0;
			const homeBonus = v.homeChurchId === slot.churchId ? -0.25 : 0;
			const score =
				b.hours + b.shiftCount * 0.1 + hist * histWeight + homeBonus + rand() * 0.05;
			return { v, score };
		});
		scored.sort((a, b) => a.score - b.score);

		return scored.slice(0, slot.requiredVolunteers).map((x) => x.v);
	}

	// Mark the generation time so git history shows when a populate happened.
	nextSchedule.generatedAt = new Date().toISOString();

	// Silence unused-var warning for volunteerById (used only in closures).
	void volunteerById;

	return {
		schedule: nextSchedule,
		events: nextEvents,
		summary: {
			slotsConsidered: slots.length,
			slotsFilled,
			slotsKept,
			slotsSkippedNoCandidate,
			volunteersWithShift,
			volunteersStillZero
		}
	};
}
