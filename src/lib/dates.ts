/**
 * Small date helpers used across the app. Intentionally minimal — we just
 * format to `YYYY-MM`, `YYYY-MM-DD`, and short display strings. All work
 * in Asia/Jakarta (WIB) by default but accept an override.
 */

export function currentMonthYYYYMM(now: Date = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	return `${y}-${m}`;
}

/** `2026-04` -> { year: 2026, month: 4 } (1-indexed month). */
export function parseMonth(ym: string): { year: number; month: number } {
	const [y, m] = ym.split('-').map(Number);
	return { year: y, month: m };
}

/** Returns every Date in the given YYYY-MM that matches the given day-of-week (0=Sun..6=Sat). */
export function datesInMonthMatchingDow(ym: string, dow: number): Date[] {
	const { year, month } = parseMonth(ym);
	const daysInMonth = new Date(year, month, 0).getDate();
	const out: Date[] = [];
	for (let d = 1; d <= daysInMonth; d++) {
		const dt = new Date(year, month - 1, d);
		if (dt.getDay() === dow) out.push(dt);
	}
	return out;
}

/** Format Date as `YYYY-MM-DD` (local calendar — no TZ shift). */
export function toIsoDate(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

/** Short English display: `Sun 19 Apr 2026`. */
export function formatShortDate(d: Date | string, locale = 'en-GB'): string {
	const dt = typeof d === 'string' ? new Date(d + 'T00:00:00') : d;
	return dt.toLocaleDateString(locale, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
}

/** Full month label: `April 2026`. */
export function formatMonthLabel(ym: string, locale = 'en-GB'): string {
	const { year, month } = parseMonth(ym);
	return new Date(year, month - 1, 1).toLocaleDateString(locale, {
		month: 'long',
		year: 'numeric'
	});
}

/** Previous YYYY-MM. */
export function previousMonth(ym: string): string {
	const { year, month } = parseMonth(ym);
	const prev = new Date(year, month - 2, 1);
	return currentMonthYYYYMM(prev);
}

/** Next YYYY-MM. */
export function nextMonth(ym: string): string {
	const { year, month } = parseMonth(ym);
	const next = new Date(year, month, 1);
	return currentMonthYYYYMM(next);
}

/** Day-of-week string from schema (mon/tue/.../sun) -> 0=Sun..6=Sat mapping. */
export const DOW_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export function dowIndex(dow: string): number {
	return DOW_ORDER.indexOf(dow as (typeof DOW_ORDER)[number]);
}
