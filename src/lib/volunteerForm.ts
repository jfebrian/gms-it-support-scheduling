import { Volunteer, WeeklyUnavailability, type Volunteer as VolunteerT, DayOfWeek } from './schemas';

/**
 * Parses a volunteer form submission into a validated Volunteer object.
 *
 * Form shape (both new and edit pages use this):
 *   id: string
 *   name: string
 *   active: "on" | undefined
 *   homeChurchId: string ("" means null)
 *   assignableChurchIds: string[] (multiple values via repeat name)
 *   weeklyUnavailability: JSON string (array of { dayOfWeek, startTime?, endTime? })
 *
 * Returns { ok: true, volunteer } on success, or { ok: false, error, fieldErrors } on failure
 * where fieldErrors is a flat { [field]: string } for rendering next to each input.
 */
export function parseVolunteerForm(
	form: FormData
): { ok: true; volunteer: VolunteerT } | { ok: false; error: string; fieldErrors: Record<string, string> } {
	// weeklyUnavailability travels as a JSON payload so each rule can carry optional
	// start/end times without fighting repeated-field semantics. Tolerate missing/broken
	// JSON by defaulting to an empty list — the Zod parse below will produce a field
	// error if the cleaned entries don't match.
	let weeklyUnavailabilityRaw: unknown = [];
	const rawPayload = form.get('weeklyUnavailability');
	if (typeof rawPayload === 'string' && rawPayload.trim().length > 0) {
		try {
			weeklyUnavailabilityRaw = JSON.parse(rawPayload);
		} catch {
			// leave as []
		}
	}

	const raw = {
		id: String(form.get('id') ?? '').trim(),
		name: String(form.get('name') ?? '').trim(),
		active: form.get('active') === 'on',
		homeChurchId: String(form.get('homeChurchId') ?? '').trim() || null,
		assignableChurchIds: form
			.getAll('assignableChurchIds')
			.map((x) => String(x).trim())
			.filter(Boolean),
		weeklyUnavailability: weeklyUnavailabilityRaw
	};

	const parsed = Volunteer.safeParse(raw);
	if (!parsed.success) {
		const fieldErrors: Record<string, string> = {};
		for (const issue of parsed.error.issues) {
			const key = String(issue.path[0] ?? '_');
			if (!fieldErrors[key]) fieldErrors[key] = issue.message;
		}
		return {
			ok: false,
			error: parsed.error.issues[0]?.message ?? 'Invalid volunteer data',
			fieldErrors
		};
	}
	return { ok: true, volunteer: parsed.data };
}

export const DAY_OF_WEEK_OPTIONS: ReadonlyArray<{ value: DayOfWeek; label: string }> = [
	{ value: 'mon', label: 'Senin' },
	{ value: 'tue', label: 'Selasa' },
	{ value: 'wed', label: 'Rabu' },
	{ value: 'thu', label: 'Kamis' },
	{ value: 'fri', label: 'Jumat' },
	{ value: 'sat', label: 'Sabtu' },
	{ value: 'sun', label: 'Minggu' }
];

export { WeeklyUnavailability };
