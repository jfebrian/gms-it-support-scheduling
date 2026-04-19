import type { AppConfig } from './storage';
import {
	SERVICE_DURATION_MIN,
	type Church,
	type EventChurchBlock,
	type EventService,
	type SpecificUnavailabilityDate,
	type UnavailabilityFile,
	type Volunteer,
	type WeeklyUnavailability
} from './schemas';

/**
 * Filter volunteers eligible for a given church+date. Returns a classified list:
 *   available — can serve (possibly with a "partial" hint)
 *   ineligible — active=false, or wrong church, or whole-day unavailable (weekly/specific)
 *
 * A weekly/specific unavailability entry with no times blocks the whole day.
 * An entry with times blocks only that window; since this classifier operates at
 * date granularity (not per-service), partial-window entries leave the volunteer
 * marked available with a hint in `reason` so the UI can surface it to the
 * scheduler, who can then decide whether the shift overlaps the blocked window.
 */
export type VolunteerAvailability = {
	volunteer: Volunteer;
	available: boolean;
	reason: string;
};

const DAY_INDEX_TO_DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function formatRange(startTime?: string, endTime?: string): string {
	if (startTime && endTime) return `${startTime}–${endTime}`;
	if (startTime) return `from ${startTime}`;
	if (endTime) return `until ${endTime}`;
	return '';
}

function isWholeDay(entry: { startTime?: string; endTime?: string }): boolean {
	return !entry.startTime && !entry.endTime;
}

export function classifyVolunteersForDate(
	config: AppConfig,
	churchId: string,
	dateIso: string,
	unavailability: UnavailabilityFile | null
): VolunteerAvailability[] {
	// `dateIso` is YYYY-MM-DD; build a Date in UTC to avoid TZ drift when picking dow.
	const [y, m, d] = dateIso.split('-').map(Number);
	const dow = DAY_INDEX_TO_DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];

	// Index specific unavailability by volunteer → date → entry (for this date only).
	const specificByVol = new Map<string, SpecificUnavailabilityDate>();
	if (unavailability) {
		for (const e of unavailability.entries) {
			const hit = e.dates.find((entry) => entry.date === dateIso);
			if (hit) specificByVol.set(e.volunteerId, hit);
		}
	}

	return config.volunteers
		.map((v): VolunteerAvailability => {
			if (!v.active) return { volunteer: v, available: false, reason: 'inactive' };
			if (!v.assignableChurchIds.includes(churchId))
				return { volunteer: v, available: false, reason: 'not assignable at this church' };

			// Weekly unavailability for this day-of-week.
			const weeklyHits: WeeklyUnavailability[] = v.weeklyUnavailability.filter(
				(w) => w.dayOfWeek === dow
			);
			for (const w of weeklyHits) {
				if (isWholeDay(w)) {
					return {
						volunteer: v,
						available: false,
						reason: `weekly unavailable on ${dow}`
					};
				}
			}

			// Specific unavailability for this date.
			const specific = specificByVol.get(v.id);
			if (specific) {
				if (isWholeDay(specific)) {
					return { volunteer: v, available: false, reason: 'marked unavailable this date' };
				}
			}

			// Still available — surface any partial-window hints in the reason.
			const hints: string[] = [];
			for (const w of weeklyHits) {
				if (!isWholeDay(w)) hints.push(`weekly ${formatRange(w.startTime, w.endTime)}`);
			}
			if (specific && !isWholeDay(specific)) {
				hints.push(`this date ${formatRange(specific.startTime, specific.endTime)}`);
			}
			return {
				volunteer: v,
				available: true,
				reason: hints.length > 0 ? `partially unavailable (${hints.join('; ')})` : ''
			};
		})
		.sort((a, b) => {
			// Available first, then alphabetical.
			if (a.available !== b.available) return a.available ? -1 : 1;
			return a.volunteer.name.localeCompare(b.volunteer.name);
		});
}

/**
 * Compute total service hours covered by a shift (for hoursCounted snapshot).
 * Every service is assumed to be `SERVICE_DURATION_MIN` minutes long — we used
 * to carry per-service duration but Joanda confirmed the uniform assumption
 * covers every GMS local church's lineup today.
 *
 * `services` is still accepted so callers can verify the shift's service IDs
 * actually resolve; unknown IDs contribute zero, matching the previous
 * behaviour.
 */
export function computeShiftHours(
	services: ReadonlyArray<{ id: string }>,
	shiftServiceIds: ReadonlyArray<string>
): number {
	const known = new Set(services.map((s) => s.id));
	let count = 0;
	for (const sid of shiftServiceIds) {
		if (known.has(sid)) count++;
	}
	return (count * SERVICE_DURATION_MIN) / 60;
}

/** Deterministic assignment IDs so upserts don't create duplicates. */
export function weeklyAssignmentId(
	date: string,
	churchId: string,
	shiftId: string
): string {
	return `asg-${date}-${churchId}-${shiftId}`;
}
export function eventAssignmentId(
	eventId: string,
	churchId: string,
	shiftId: string
): string {
	return `asg-${eventId}-${churchId}-${shiftId}`;
}

/**
 * Resolve the list of services that apply to an event's church block.
 *
 * - If the block has an explicit `services` override (non-empty), use it.
 * - Otherwise default to the church's weekly Sunday services that require IT
 *   Support — dropping EK kids ministries and anything else the church has
 *   flagged as `requiresItSupport: false`. This captures the common case for
 *   events like Jumat Agung / Christmas: same IT-relevant lineup as a normal
 *   Sunday, just on a different date.
 *
 * The returned shape matches `EventService` (no `dayOfWeek`), so callers
 * can treat it identically whether overridden or defaulted.
 */
export function resolveEventServices(
	church: Church,
	block: Pick<EventChurchBlock, 'services'>
): EventService[] {
	if (block.services.length > 0) return block.services;
	return church.weeklyServices
		.filter((s) => s.dayOfWeek === 'sun' && s.requiresItSupport)
		.map(({ id, startTime, name, requiresItSupport }) => ({
			id,
			startTime,
			name,
			requiresItSupport
		}));
}
