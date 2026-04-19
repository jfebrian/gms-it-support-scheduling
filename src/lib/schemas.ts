import { z } from 'zod';

// ============================================================================
// Primitives
// ============================================================================

export const DayOfWeek = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type DayOfWeek = z.infer<typeof DayOfWeek>;

/** lowercase kebab-case identifier, e.g. `bandung-pusat`, `joanda-s` */
export const IdString = z
	.string()
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase kebab-case (letters/digits separated by hyphens)');

/** `HH:MM` in 24-hour format */
export const TimeHHMM = z
	.string()
	.regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM in 24-hour format');

/** `YYYY-MM-DD` */
export const DateYYYYMMDD = z
	.string()
	.regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/, 'must be YYYY-MM-DD');

/** `YYYY-MM` */
export const MonthYYYYMM = z
	.string()
	.regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'must be YYYY-MM');

// ============================================================================
// regions.yaml — list of GMS regions
// ============================================================================

export const Region = z.object({
	id: IdString,
	name: z.string().min(1)
});
export type Region = z.infer<typeof Region>;
export const RegionsFile = z.array(Region);
export type RegionsFile = z.infer<typeof RegionsFile>;

// ============================================================================
// churches.yaml — all local churches with their weekly service+shift templates
// ============================================================================

/**
 * Assumed duration of a single service in minutes. The scheduler uses this to
 * compute shift end times (for availability checks) and to snapshot shift
 * hours. Keeping it as a global constant (rather than a per-service field)
 * matches how Joanda actually plans the month — a service is roughly two
 * hours, full stop.
 */
export const SERVICE_DURATION_MIN = 120;

export const ServiceTemplate = z.object({
	id: IdString,
	dayOfWeek: DayOfWeek,
	startTime: TimeHHMM,
	name: z.string().min(1),
	requiresItSupport: z.boolean()
});
export type ServiceTemplate = z.infer<typeof ServiceTemplate>;

/**
 * Week-of-month index used by `ShiftTemplate.weeks` to restrict a recurring
 * shift to specific weeks. 1-indexed by the shift's calendar date within the
 * month (1 = first occurrence, 2 = second, ...). Most months have 4 weeks,
 * some 5; we cap at 5 because no church actually needs "the 6th week".
 */
export const WeekOfMonth = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
export type WeekOfMonth = z.infer<typeof WeekOfMonth>;

export const ShiftTemplate = z.object({
	id: IdString,
	label: z.string().min(1).optional(),
	serviceIds: z.array(IdString).min(1),
	requiredVolunteers: z.number().int().positive(),
	/**
	 * Optional whitelist of specific weeks of the month (1-5, counted by the
	 * shift's service day: e.g. "1" = the first Sunday/Saturday in the month).
	 * Empty or absent = every week (default behavior, matches historical data).
	 * Example: a "first-week-only" special service sets `weeks: [1]`.
	 */
	weeks: z.array(WeekOfMonth).default([])
});
export type ShiftTemplate = z.infer<typeof ShiftTemplate>;

/**
 * Hex accent color for per-church UI. Stored as `#RRGGBB` (lowercase) so it
 * plugs directly into `<input type="color">` and `style="background-color:"`
 * at call sites. Soft/zebra variants are derived via CSS `color-mix(in srgb,
 * var(--c-accent) 8%, transparent)` at render time instead of baked-in
 * alpha, which keeps the source of truth single-valued.
 */
export const HexColor = z
	.string()
	.regex(/^#[0-9a-f]{6}$/i, 'must be #RRGGBB hex (e.g. "#3b82f6")')
	.transform((s) => s.toLowerCase());

export const Church = z
	.object({
		id: IdString,
		name: z.string().min(1),
		/**
		 * True ONLY for churches that actually upload a livestream to YouTube.
		 * Non-livestream churches mirror another church's stream on-site and
		 * don't need a youtubeChannelId.
		 */
		livestream: z.boolean().default(false),
		youtubeChannelId: IdString.nullable().default(null),
		/** Accent color used to visually distinguish churches in schedule cards. */
		color: HexColor,
		weeklyServices: z.array(ServiceTemplate).default([]),
		weeklyShifts: z.array(ShiftTemplate).default([])
	})
	.superRefine((church, ctx) => {
		// Intra-church integrity: shift.serviceIds must exist in weeklyServices
		const serviceIds = new Set(church.weeklyServices.map((s) => s.id));
		for (const [shiftIdx, shift] of church.weeklyShifts.entries()) {
			for (const [svcIdx, svcId] of shift.serviceIds.entries()) {
				if (!serviceIds.has(svcId)) {
					ctx.addIssue({
						code: 'custom',
						path: ['weeklyShifts', shiftIdx, 'serviceIds', svcIdx],
						message: `shift references unknown service id '${svcId}' (not in this church's weeklyServices)`
					});
				}
			}
		}
		// Service IDs must be unique within a church
		const seenServiceIds = new Set<string>();
		for (const [idx, s] of church.weeklyServices.entries()) {
			if (seenServiceIds.has(s.id)) {
				ctx.addIssue({
					code: 'custom',
					path: ['weeklyServices', idx, 'id'],
					message: `duplicate service id '${s.id}' within this church`
				});
			}
			seenServiceIds.add(s.id);
		}
		// Shift IDs must be unique within a church
		const seenShiftIds = new Set<string>();
		for (const [idx, sh] of church.weeklyShifts.entries()) {
			if (seenShiftIds.has(sh.id)) {
				ctx.addIssue({
					code: 'custom',
					path: ['weeklyShifts', idx, 'id'],
					message: `duplicate shift id '${sh.id}' within this church`
				});
			}
			seenShiftIds.add(sh.id);
		}
	});
export type Church = z.infer<typeof Church>;
export const ChurchesFile = z.array(Church);
export type ChurchesFile = z.infer<typeof ChurchesFile>;

// ============================================================================
// volunteers.yaml — IT Support roster with constraints
// ============================================================================

/**
 * A recurring weekly window the volunteer can't serve.
 *
 * - No times → the whole day is blocked ("can't do Saturdays").
 * - With startTime/endTime → only that window is blocked ("can't do
 *   Sunday morning up to 11:00" → { dayOfWeek: 'sun', endTime: '11:00' }).
 *
 * Open-ended ranges are allowed: only startTime = blocked from then onward;
 * only endTime = blocked until then.
 */
export const WeeklyUnavailability = z.object({
	dayOfWeek: DayOfWeek,
	startTime: TimeHHMM.optional(),
	endTime: TimeHHMM.optional()
});
export type WeeklyUnavailability = z.infer<typeof WeeklyUnavailability>;

export const Volunteer = z.object({
	id: IdString,
	name: z.string().min(1),
	/**
	 * Soft-delete flag. Historical assignments keep referencing inactive volunteers,
	 * but the scheduler and volunteer-picker UI exclude them. Default true.
	 */
	active: z.boolean().default(true),
	homeChurchId: IdString.nullable().default(null),
	/**
	 * Strict whitelist of churches the volunteer may be assigned to.
	 * When creating a volunteer via the UI, this defaults to all churches.
	 */
	assignableChurchIds: z.array(IdString).default([]),
	/** Recurring weekly unavailability (same every week). Optional time ranges per day. */
	weeklyUnavailability: z.array(WeeklyUnavailability).default([])
});
export type Volunteer = z.infer<typeof Volunteer>;
export const VolunteersFile = z.array(Volunteer);
export type VolunteersFile = z.infer<typeof VolunteersFile>;

// ============================================================================
// youtube_channels.yaml — region-keyed channels
// ============================================================================

export const YouTubeChannel = z.object({
	id: IdString,
	/** The actual YouTube channel ID (e.g. "UCxxxxxxxxxxxxxxxxxxxxxx") */
	youtubeChannelId: z.string().min(1),
	name: z.string().min(1),
	regionId: IdString,
	servesChurchIds: z.array(IdString).default([]),
	notes: z.string().default('')
});
export type YouTubeChannel = z.infer<typeof YouTubeChannel>;
export const YouTubeChannelsFile = z.array(YouTubeChannel);
export type YouTubeChannelsFile = z.infer<typeof YouTubeChannelsFile>;

// ============================================================================
// unavailability/YYYY-MM.yaml — one-off dates volunteers can't serve
// ============================================================================

/**
 * A specific (ad-hoc) unavailable date for a volunteer.
 *
 * - No times → the whole date is blocked.
 * - With startTime/endTime → only that window is blocked that day.
 *
 * Multi-day absences are represented as multiple entries, one per date.
 * Reason is intentionally not tracked — it's volunteering, not leave.
 */
export const SpecificUnavailabilityDate = z.object({
	date: DateYYYYMMDD,
	startTime: TimeHHMM.optional(),
	endTime: TimeHHMM.optional()
});
export type SpecificUnavailabilityDate = z.infer<typeof SpecificUnavailabilityDate>;

export const UnavailabilityEntry = z.object({
	volunteerId: IdString,
	dates: z.array(SpecificUnavailabilityDate).default([])
});
export type UnavailabilityEntry = z.infer<typeof UnavailabilityEntry>;

export const UnavailabilityFile = z.object({
	month: MonthYYYYMM,
	entries: z.array(UnavailabilityEntry).default([])
});
export type UnavailabilityFile = z.infer<typeof UnavailabilityFile>;

// ============================================================================
// schedules/YYYY-MM.yaml — monthly schedule (input + generated)
// ============================================================================

export const WeekOverride = z.object({
	allChurchesRequireItSupport: z.boolean().default(false),
	notes: z.string().default('')
});
export type WeekOverride = z.infer<typeof WeekOverride>;

/** Deterministic pattern: `asg-<date>-<churchId>-<shiftId>` for weekly, `asg-<eventId>-<shiftId>` for events. */
export const AssignmentId = z.string().min(1);

export const Assignment = z.object({
	id: AssignmentId,
	date: DateYYYYMMDD,
	churchId: IdString,
	shiftId: IdString,
	/** Snapshot of service IDs at assignment time (stable if church template changes later). */
	serviceIds: z.array(IdString).default([]),
	volunteerIds: z.array(IdString).default([]),
	/** Snapshot of total hours at assignment time. */
	hoursCounted: z.number().nonnegative(),
	/**
	 * Locks the assignment from being overwritten by the randomizer / scheduler.
	 * Flipping this on means "this slot is confirmed, don't touch it when I
	 * re-randomize the month".
	 */
	confirmed: z.boolean().default(false),
	notes: z.string().default('')
});
export type Assignment = z.infer<typeof Assignment>;

export const MonthlySchedule = z.object({
	month: MonthYYYYMM,
	generatedAt: z.string().optional(),
	/** Keyed by Sunday-of-the-week (YYYY-MM-DD). Only weeks that need overrides appear. */
	weekOverrides: z.record(DateYYYYMMDD, WeekOverride).default({}),
	assignments: z.array(Assignment).default([])
});
export type MonthlySchedule = z.infer<typeof MonthlySchedule>;

// ============================================================================
// events/YYYY-MM-DD-<slug>.yaml — one-off event services
// ============================================================================

export const EventService = z.object({
	id: IdString,
	startTime: TimeHHMM,
	name: z.string().min(1),
	requiresItSupport: z.boolean().default(true)
});
export type EventService = z.infer<typeof EventService>;

export const EventShift = z.object({
	id: IdString,
	label: z.string().min(1).optional(),
	serviceIds: z.array(IdString).min(1),
	requiredVolunteers: z.number().int().positive()
});
export type EventShift = z.infer<typeof EventShift>;

/** Same shape as weekly Assignment, but date+churchId are inherited from the enclosing Event. */
export const EventAssignment = z.object({
	id: AssignmentId,
	shiftId: IdString,
	serviceIds: z.array(IdString).default([]),
	volunteerIds: z.array(IdString).default([]),
	hoursCounted: z.number().nonnegative(),
	/** Locks the assignment from the randomizer — see Assignment.confirmed. */
	confirmed: z.boolean().default(false),
	notes: z.string().default('')
});
export type EventAssignment = z.infer<typeof EventAssignment>;

/**
 * One church's slice of an event. Most events are held simultaneously at many
 * churches, so a single event file lists a block per participating church.
 *
 * `services` is an override. When left empty, the resolver (see
 * `$lib/assignmentHelpers.resolveEventServices`) fills it in from the church's
 * weekly Sunday services, dropping services that don't need IT Support (e.g.
 * EK kids ministries). This captures the common case — Jumat Agung,
 * Christmas — where the event just re-uses each church's normal Sunday lineup.
 */
export const EventChurchBlock = z.object({
	churchId: IdString,
	services: z.array(EventService).default([]),
	shifts: z.array(EventShift).default([]),
	assignments: z.array(EventAssignment).default([])
});
export type EventChurchBlock = z.infer<typeof EventChurchBlock>;

export const EventFile = z
	.object({
		id: z.string().min(1),
		name: z.string().min(1),
		date: DateYYYYMMDD,
		churches: z.array(EventChurchBlock).min(1)
	})
	.superRefine((ev, ctx) => {
		const seenChurchIds = new Set<string>();
		for (const [bIdx, b] of ev.churches.entries()) {
			if (seenChurchIds.has(b.churchId)) {
				ctx.addIssue({
					code: 'custom',
					path: ['churches', bIdx, 'churchId'],
					message: `duplicate block for churchId '${b.churchId}' within this event`
				});
			}
			seenChurchIds.add(b.churchId);

			// When services are explicitly overridden, validate shift.serviceIds
			// against them here. When services is empty (defaulted from the church
			// template), cross-ref validation happens after resolution at load time.
			if (b.services.length > 0) {
				const serviceIds = new Set(b.services.map((s) => s.id));
				for (const [shiftIdx, shift] of b.shifts.entries()) {
					for (const [svcIdx, svcId] of shift.serviceIds.entries()) {
						if (!serviceIds.has(svcId)) {
							ctx.addIssue({
								code: 'custom',
								path: ['churches', bIdx, 'shifts', shiftIdx, 'serviceIds', svcIdx],
								message: `shift references unknown event service id '${svcId}'`
							});
						}
					}
				}
			}
			const shiftIds = new Set(b.shifts.map((s) => s.id));
			for (const [idx, a] of b.assignments.entries()) {
				if (!shiftIds.has(a.shiftId)) {
					ctx.addIssue({
						code: 'custom',
						path: ['churches', bIdx, 'assignments', idx, 'shiftId'],
						message: `assignment references unknown shift id '${a.shiftId}'`
					});
				}
			}
		}
	});
export type EventFile = z.infer<typeof EventFile>;

// ============================================================================
// settings.yaml — app-level configuration
// ============================================================================

export const Settings = z.object({
	youtube: z
		.object({
			pollingIntervalSeconds: z.number().int().positive().default(60),
			bufferingWindowSeconds: z.number().int().positive().default(120),
			bufferingThresholdCount: z.number().int().positive().default(5),
			streamDownGraceSeconds: z.number().int().positive().default(30)
		})
		.prefault({}),
	scheduling: z
		.object({
			defaultMaxHoursPerDay: z.number().positive().default(8),
			defaultServiceDurationMinutes: z.number().int().positive().default(90)
		})
		.prefault({}),
	i18n: z
		.object({
			defaultLocale: z.string().default('en'),
			supportedLocales: z.array(z.string()).default(['en', 'id'])
		})
		.prefault({}),
	timezone: z.string().default('Asia/Jakarta')
});
export type Settings = z.infer<typeof Settings>;

// ============================================================================
// fairness/YYYY-MM.json — machine-generated, feeds next month's scheduler
// ============================================================================

export const FairnessVolunteerRecord = z.object({
	hoursAssigned: z.number().nonnegative(),
	shiftsAssigned: z.number().int().nonnegative(),
	servicesCovered: z.number().int().nonnegative()
});
export type FairnessVolunteerRecord = z.infer<typeof FairnessVolunteerRecord>;

export const FairnessRunningBalance = z.object({
	/** Sum across months of (this volunteer's hours) − (average volunteer's hours). Negative = owed more. */
	cumulativeHoursOverAverage: z.number()
});
export type FairnessRunningBalance = z.infer<typeof FairnessRunningBalance>;

export const FairnessLog = z.object({
	month: MonthYYYYMM,
	generatedAt: z.string(),
	perVolunteer: z.record(IdString, FairnessVolunteerRecord).default({}),
	runningBalance: z.record(IdString, FairnessRunningBalance).default({})
});
export type FairnessLog = z.infer<typeof FairnessLog>;

// ============================================================================
// incidents/YYYY-MM-DD-<slug>.json — machine-generated livestream issues
// ============================================================================

export const IncidentType = z.enum(['stream_down', 'frequent_buffering', 'stream_not_started']);
export type IncidentType = z.infer<typeof IncidentType>;

export const IncidentSeverity = z.enum(['low', 'medium', 'high']);
export type IncidentSeverity = z.infer<typeof IncidentSeverity>;

export const Incident = z.object({
	id: z.string().min(1),
	detectedAt: z.string(),
	type: IncidentType,
	severity: IncidentSeverity,
	churchId: IdString,
	youtubeChannelId: IdString.optional(),
	youtubeVideoId: z.string().optional(),
	details: z.record(z.string(), z.unknown()).default({}),
	resolvedAt: z.string().nullable().default(null),
	resolutionNotes: z.string().nullable().default(null)
});
export type Incident = z.infer<typeof Incident>;
