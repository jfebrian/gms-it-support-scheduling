<script lang="ts">
	import { page } from '$app/state';
	import { enhance } from '$app/forms';
	import {
		formatMonthLabel,
		nextMonth,
		parseMonth,
		previousMonth,
		toIsoDate
	} from '$lib/dates';
	import {
		buildScheduleView,
		type ChurchView,
		type DisplayItem,
		type ScheduleGroup,
		type ShiftBlock
	} from '$lib/scheduleView';
	import type {
		Church,
		SpecificUnavailabilityDate,
		UnavailabilityEntry,
		Volunteer
	} from '$lib/schemas';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Tab selection is in the URL (?tab=unavailability) so deep-links work and
	// the server action can redirect back to the right tab after save.
	const currentTab = $derived(
		page.url.searchParams.get('tab') === 'unavailability' ? 'unavailability' : 'schedule'
	);

	const volunteerNameById = $derived(
		new Map(data.config.volunteers.map((v) => [v.id, v.name]))
	);
	function volName(id: string): string {
		return volunteerNameById.get(id) ?? id;
	}

	const churchViews = $derived(
		buildScheduleView(data.month, data.config.churches, data.schedule, data.events)
	);

	function totalShifts(view: ChurchView): number {
		return view.groups.reduce((n, g) => n + g.shiftBlocks.length, 0);
	}

	/**
	 * Sort order for the schedule columns:
	 *   1. Livestream churches first (Central Park + Gandaria City) — Joanda
	 *      wants these pinned so anyone scanning the page sees the broadcast
	 *      rosters immediately.
	 *   2. Within each livestream bucket, heaviest-schedule churches first so
	 *      the LPT partition has the largest cards to place.
	 *   3. Ties keep churches.yaml order.
	 */
	const visibleViews = $derived(
		churchViews
			.filter((v) => v.groups.length > 0)
			.map((v, i) => ({ v, i }))
			.sort((a, b) => {
				if (a.v.church.livestream !== b.v.church.livestream) {
					return a.v.church.livestream ? -1 : 1;
				}
				const d = totalShifts(b.v) - totalShifts(a.v);
				return d !== 0 ? d : a.i - b.i;
			})
			.map((x) => x.v)
	);

	/**
	 * LPT partition, livestream-aware. Livestream churches are placed first in
	 * separate columns (left, then right) so both columns lead with a
	 * broadcasting site. Everything else then falls into the shorter column
	 * greedily. For Joanda's roster this produces: Central Park top-left,
	 * Gandaria City top-right.
	 */
	const partitioned = $derived.by(() => {
		const left: ChurchView[] = [];
		const right: ChurchView[] = [];
		let lSum = 0;
		let rSum = 0;
		const livestream = visibleViews.filter((v) => v.church.livestream);
		const rest = visibleViews.filter((v) => !v.church.livestream);
		for (let i = 0; i < livestream.length; i++) {
			const v = livestream[i];
			const n = totalShifts(v);
			// First livestream → left, second → right, extras go to shorter column.
			if (i === 0) {
				left.push(v);
				lSum += n;
			} else if (i === 1) {
				right.push(v);
				rSum += n;
			} else if (lSum <= rSum) {
				left.push(v);
				lSum += n;
			} else {
				right.push(v);
				rSum += n;
			}
		}
		for (const v of rest) {
			const n = totalShifts(v);
			if (lSum <= rSum) {
				left.push(v);
				lSum += n;
			} else {
				right.push(v);
				rSum += n;
			}
		}
		return { left, right };
	});

	const prev = $derived(previousMonth(data.month));
	const next = $derived(nextMonth(data.month));

	/**
	 * Flatten a church view's groups/shifts/displayItems into one row per
	 * rendered `<tr>` so we can attach a running row index (for zebra
	 * striping) and compute rowspan cells with correct "isFirstOf…" flags.
	 */
	type FlatRow = {
		group: ScheduleGroup;
		groupIdx: number;
		shift: ShiftBlock;
		shiftIdx: number;
		item: DisplayItem;
		itemIdx: number;
		/** First row of the group → render the Tanggal Ibadah (rowspan) cell. */
		isFirstOfGroup: boolean;
		/** First row of the shift → render the Volunteer (rowspan) cell. */
		isFirstOfShift: boolean;
		/** Last row of the shift → draw a soft separator below. */
		isLastOfShift: boolean;
		/** Last row of the group → draw a stronger separator below. */
		isLastOfGroup: boolean;
		/** Span for the Tanggal cell (total display items in the group). */
		groupRowspan: number;
		/** Span for the Volunteer cell (display items in this shift). */
		shiftRowspan: number;
	};
	function flattenView(view: ChurchView): FlatRow[] {
		const rows: FlatRow[] = [];
		view.groups.forEach((group, groupIdx) => {
			const groupRowspan = group.shiftBlocks.reduce((n, sb) => n + sb.displayItems.length, 0);
			group.shiftBlocks.forEach((shift, shiftIdx) => {
				const shiftRowspan = shift.displayItems.length;
				shift.displayItems.forEach((item, itemIdx) => {
					rows.push({
						group,
						groupIdx,
						shift,
						shiftIdx,
						item,
						itemIdx,
						isFirstOfGroup: shiftIdx === 0 && itemIdx === 0,
						isFirstOfShift: itemIdx === 0,
						isLastOfShift: itemIdx === shiftRowspan - 1,
						isLastOfGroup:
							shiftIdx === group.shiftBlocks.length - 1 && itemIdx === shiftRowspan - 1,
						groupRowspan,
						shiftRowspan
					});
				});
			});
		});
		return rows;
	}

	// ---- Unavailability tab state ------------------------------------------

	/**
	 * Dates that actually have something scheduled this month. Only these
	 * become columns in the unavailability matrix so the admin is only ever
	 * marking dates that matter.
	 */
	type ShiftBearingDate = { date: string; label: string };
	const shiftBearingDates = $derived.by((): ShiftBearingDate[] => {
		const out = new Map<string, string>();
		const { year, month } = parseMonth(data.month);
		const lastDay = new Date(year, month, 0).getDate();
		const daysInMonth: string[] = [];
		for (let d = 1; d <= lastDay; d++) {
			daysInMonth.push(toIsoDate(new Date(year, month - 1, d)));
		}

		for (const view of churchViews) {
			for (const group of view.groups) {
				for (const shift of group.shiftBlocks) {
					const shiftDate = dateFromShiftKey(shift.key);
					if (!shiftDate) continue;
					const existing = out.get(shiftDate);
					const priority = (l: string) =>
						l.startsWith('Ibadah Awal Bulan') ? 2 : l === 'Ibadah Mingguan' ? 1 : 3;
					const candidate = group.title || 'Ibadah';
					if (!existing || priority(candidate) > priority(existing)) {
						out.set(shiftDate, candidate);
					}
				}
			}
		}

		return daysInMonth
			.filter((d) => out.has(d))
			.map((d) => ({ date: d, label: out.get(d) ?? 'Ibadah' }));
	});

	/** Pull the date out of the stable shift key (`weekly:YYYY-MM-DD:…` or `event:<evId>:…`). */
	function dateFromShiftKey(key: string): string | null {
		const [kind, a] = key.split(':');
		if (kind === 'weekly') return a ?? null;
		if (kind === 'event') {
			const ev = data.events.find((e) => e.id === a);
			return ev?.date ?? null;
		}
		return null;
	}

	/** "2026-04-04" → { weekday: "Sab", d: "4 Apr" } for a short two-line header. */
	function splitShortDate(iso: string): { weekday: string; d: string } {
		const [y, m, d] = iso.split('-').map(Number);
		const dt = new Date(y, m - 1, d);
		return {
			weekday: dt.toLocaleDateString('id-ID', { weekday: 'short' }),
			d: dt.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
		};
	}

	const DAY_INDEX_TO_DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
	function dowOfIso(iso: string): (typeof DAY_INDEX_TO_DOW)[number] {
		const [y, m, d] = iso.split('-').map(Number);
		return DAY_INDEX_TO_DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
	}

	/**
	 * True if this volunteer has a *whole-day* weekly unavailability rule that
	 * covers the given ISO date's day-of-week. The matrix auto-checks those
	 * cells and disables them (Joanda's request 2026-04-19) so the admin
	 * doesn't need to duplicate weekly rules as specific dates.
	 *
	 * Partial-window weekly rules are intentionally NOT treated as blocked
	 * here — the admin may still want to add a specific block for the rest
	 * of that day.
	 */
	function isWeeklyBlocked(v: Volunteer, iso: string): boolean {
		const dow = dowOfIso(iso);
		return v.weeklyUnavailability.some(
			(w) => w.dayOfWeek === dow && !w.startTime && !w.endTime
		);
	}

	// Editable state: map volunteerId → Map<date, {startTime, endTime}>.
	type DayEntry = { startTime: string; endTime: string };
	function initialRows(): Map<string, Map<string, DayEntry>> {
		const map = new Map<string, Map<string, DayEntry>>();
		for (const e of data.unavailability.entries) {
			const inner = new Map<string, DayEntry>();
			for (const d of e.dates) {
				inner.set(d.date, { startTime: d.startTime ?? '', endTime: d.endTime ?? '' });
			}
			map.set(e.volunteerId, inner);
		}
		return map;
	}
	let rows = $state<Map<string, Map<string, DayEntry>>>(initialRows());

	/**
	 * Which volunteers have a row in the table. Starts populated from whoever
	 * already has saved unavailability (so a reload doesn't lose data), but new
	 * volunteers are added one at a time via the "+ Add volunteer" picker.
	 * Admins don't need a row for everyone — most people just… can serve.
	 */
	let selectedVolunteerIds = $state<string[]>(
		data.unavailability.entries.map((e) => e.volunteerId)
	);
	const selectedVolunteers = $derived(
		selectedVolunteerIds
			.map((id) => data.config.volunteers.find((v) => v.id === id))
			.filter((v): v is Volunteer => !!v)
	);
	const availableToAdd = $derived(
		data.config.volunteers.filter(
			(v) => v.active && !selectedVolunteerIds.includes(v.id)
		)
	);
	let volunteerToAdd = $state<string>('');
	function addSelectedVolunteer() {
		if (!volunteerToAdd) return;
		if (selectedVolunteerIds.includes(volunteerToAdd)) return;
		selectedVolunteerIds = [...selectedVolunteerIds, volunteerToAdd];
		volunteerToAdd = '';
	}
	function removeVolunteer(vid: string) {
		selectedVolunteerIds = selectedVolunteerIds.filter((id) => id !== vid);
		rows.delete(vid);
		rows = new Map(rows);
	}

	function rowFor(vid: string): Map<string, DayEntry> {
		let r = rows.get(vid);
		if (!r) {
			r = new Map();
			rows.set(vid, r);
			rows = new Map(rows);
		}
		return r;
	}
	function toggleDate(vid: string, date: string) {
		const r = rowFor(vid);
		if (r.has(date)) r.delete(date);
		else r.set(date, { startTime: '', endTime: '' });
		rows = new Map(rows);
	}
	function setTime(vid: string, date: string, field: 'startTime' | 'endTime', val: string) {
		const r = rowFor(vid);
		const cur = r.get(date) ?? { startTime: '', endTime: '' };
		r.set(date, { ...cur, [field]: val });
		rows = new Map(rows);
	}
	function hasDate(vid: string, date: string): boolean {
		return rows.get(vid)?.has(date) ?? false;
	}
	function entryFor(vid: string, date: string): DayEntry | undefined {
		return rows.get(vid)?.get(date);
	}

	/**
	 * Serialize to JSON for submission. We only persist user-entered specific
	 * unavailability; dates that are weekly-blocked are already represented on
	 * the volunteer profile, so saving them here would duplicate the data.
	 */
	const unavailabilityPayload = $derived(
		JSON.stringify({
			month: data.month,
			entries: selectedVolunteerIds
				.map((volunteerId): UnavailabilityEntry => {
					const r = rows.get(volunteerId);
					const v = data.config.volunteers.find((vv) => vv.id === volunteerId);
					const dates: SpecificUnavailabilityDate[] = Array.from(r?.entries() ?? [])
						// Drop cells that are already covered by a weekly rule so we
						// don't persist redundant specific entries.
						.filter(([date]) => !(v && isWeeklyBlocked(v, date)))
						.sort((a, b) => a[0].localeCompare(b[0]))
						.map(([date, t]) => {
							const d: SpecificUnavailabilityDate = { date };
							if (t.startTime.trim()) d.startTime = t.startTime.trim();
							if (t.endTime.trim()) d.endTime = t.endTime.trim();
							return d;
						});
					return { volunteerId, dates };
				})
				.filter((e) => e.dates.length > 0)
		})
	);

	/**
	 * Per-church CSS custom properties for accent bar, soft header tint, and
	 * zebra stripe. Soft/zebra derive from the single hex via color-mix so we
	 * don't have to re-express alpha in three places — and `color-mix()` keeps
	 * perceptual brightness sane compared to naive RGB alpha.
	 */
	function churchStyle(church: Church): string {
		return [
			`--c-accent: ${church.color}`,
			`--c-accent-soft: color-mix(in srgb, ${church.color} 8%, transparent)`,
			`--c-zebra: color-mix(in srgb, ${church.color} 7%, transparent)`
		].join('; ');
	}
</script>

<header class="mb-6 flex flex-wrap items-start justify-between gap-4">
	<div>
		<p class="text-sm font-medium text-slate-500">Jadwal</p>
		<h1 class="text-3xl font-bold tracking-tight">{formatMonthLabel(data.month)}</h1>
	</div>
	<div class="flex items-center gap-2 text-sm">
		<a
			href="/schedule/{prev}{currentTab === 'unavailability' ? '?tab=unavailability' : ''}"
			class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
		>
			← {formatMonthLabel(prev)}
		</a>
		<a
			href="/schedule/{next}{currentTab === 'unavailability' ? '?tab=unavailability' : ''}"
			class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
		>
			{formatMonthLabel(next)} →
		</a>
		<a
			href="/schedule/{data.month}/events/new"
			class="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
			title="Tambah acara baru di bulan ini"
		>
			+ Tambah acara
		</a>
		<a
			href="/schedule/{data.month}/share"
			class="rounded-full border border-gms-500 bg-white px-4 py-1.5 font-medium text-gms-600 hover:bg-gms-50"
		>
			Bagikan jadwal
		</a>
		<form method="POST" action="?/populate" use:enhance>
			<button
				type="submit"
				class="rounded-full bg-gms-500 px-4 py-1.5 font-medium text-white hover:bg-gms-600"
				title="Acak semua slot yang belum dikonfirmasi (slot yang dikonfirmasi tetap dipertahankan)"
			>
				Acak
			</button>
		</form>
	</div>
</header>

<!-- Tabs: Schedule | Unavailability (merged from /unavailability/[month]). -->
<nav class="mb-5 flex border-b border-slate-300 text-sm font-medium">
	<a
		href="/schedule/{data.month}"
		class="-mb-px border-b-2 px-4 py-2 transition-colors {currentTab === 'schedule'
			? 'border-gms-500 text-gms-700'
			: 'border-transparent text-slate-500 hover:text-slate-700'}"
	>
		Jadwal
	</a>
	<a
		href="/schedule/{data.month}?tab=unavailability"
		class="-mb-px border-b-2 px-4 py-2 transition-colors {currentTab === 'unavailability'
			? 'border-gms-500 text-gms-700'
			: 'border-transparent text-slate-500 hover:text-slate-700'}"
	>
		Ketidakhadiran
	</a>
</nav>

{#if form?.error}
	<div class="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
		{form.error}
	</div>
{/if}

{#if currentTab === 'schedule'}
	{#if visibleViews.length === 0}
		<div class="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
			Belum ada jadwal atau acara untuk {formatMonthLabel(data.month)}.
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
		{#each [partitioned.left, partitioned.right] as column, ci (ci)}
			<div class="flex flex-col gap-6">
				{#each column as view (view.church.id)}
					{@const flatRows = flattenView(view)}
					<section
						style={churchStyle(view.church)}
						class="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm"
					>
						<header
							class="flex items-baseline justify-between border-b border-slate-300 px-4 py-3"
							style="background-color: var(--c-accent-soft); border-left: 4px solid var(--c-accent);"
						>
							<h2 class="text-base font-semibold" style="color: var(--c-accent);">
								<a href="/churches/{view.church.id}" class="hover:underline">
									{view.church.name}
								</a>
							</h2>
							{#if view.church.livestream}
								<span
									class="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
									style="color: var(--c-accent); border-color: var(--c-accent);"
								>
									Livestream
								</span>
							{/if}
						</header>

						<div class="overflow-x-auto">
							<table class="w-full border-collapse text-sm">
								<thead>
									<tr class="border-b border-slate-300 bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
										<th class="w-52 px-3 py-2 font-medium">Tanggal Ibadah</th>
										<th class="w-28 px-3 py-2 font-medium">Ibadah</th>
										<th class="px-3 py-2 font-medium">Volunteer</th>
										<th class="w-12 px-2 py-2 text-center font-medium" title="Konfirmasi — dikunci dari pengacakan">
											✓
										</th>
									</tr>
								</thead>
								<tbody>
									{#each flatRows as row, rowIdx (rowIdx)}
										{@const zebra = rowIdx % 2 === 1}
										<!--
											Group separator: when this is the last row of a group
											AND not the very last row in the card, draw a thick
											slate-400 divider so Joanda can find the date boundary
											at a glance (feedback 2026-04-19).
										-->
										<tr
											class="align-top"
											class:border-b={!row.isLastOfGroup}
											class:border-b-2={row.isLastOfGroup && rowIdx !== flatRows.length - 1}
											class:border-b-slate-200={!row.isLastOfGroup && !row.isLastOfShift}
											class:border-b-slate-300={row.isLastOfShift && !row.isLastOfGroup}
											class:border-b-slate-400={row.isLastOfGroup && rowIdx !== flatRows.length - 1}
											style={zebra
												? 'background-color: var(--c-zebra);'
												: 'background-color: transparent;'}
										>
											{#if row.isFirstOfGroup}
												<td
													class="border-r border-slate-300 bg-slate-50 px-3 py-2 align-top"
													rowspan={row.groupRowspan}
												>
													{#if row.group.title}
														<div class="font-medium text-slate-800">{row.group.title}</div>
													{/if}
													{#each row.group.dateLines as line (line)}
														<div
															class="text-xs text-slate-600"
															class:font-medium={!row.group.title}
															class:text-slate-800={!row.group.title}
														>
															{line}
														</div>
													{/each}
												</td>
											{/if}
											<td class="border-r border-slate-200 px-3 py-2 text-slate-700">
												<span class="block">{row.item.label}</span>
												{#if row.item.startTime}
													<span class="block text-xs text-slate-500">{row.item.startTime}</span>
												{/if}
											</td>
											{#if row.isFirstOfShift}
												<td
													class="bg-white px-3 py-2 align-middle"
													rowspan={row.shiftRowspan}
												>
													<a
														href={row.shift.editHref}
														class="group -mx-1 block rounded px-1 py-0.5 hover:bg-slate-100"
													>
														{#if row.shift.volunteerIds.length > 0}
															<span class="font-medium text-slate-900">
																{row.shift.volunteerIds.map(volName).join(', ')}
															</span>
														{:else}
															<span class="text-slate-400 group-hover:text-slate-600">
																— kosong —
															</span>
														{/if}
													</a>
												</td>
												<!--
													Inline confirmed toggle — lets Joanda flip the lock
													without opening the assign editor (feedback
													2026-04-19). Submits as a tiny form per shift.
												-->
												<td
													class="bg-white px-2 py-2 text-center align-middle"
													rowspan={row.shiftRowspan}
												>
													<form method="POST" action="?/toggleConfirmed" use:enhance>
														<input type="hidden" name="kind" value={row.shift.confirmRef.kind} />
														<input type="hidden" name="churchId" value={row.shift.confirmRef.churchId} />
														<input type="hidden" name="shiftId" value={row.shift.confirmRef.shiftId} />
														{#if row.shift.confirmRef.kind === 'weekly'}
															<input type="hidden" name="date" value={row.shift.confirmRef.date} />
														{:else}
															<input type="hidden" name="eventId" value={row.shift.confirmRef.eventId} />
														{/if}
														<button
															type="submit"
															class="inline-flex h-5 w-5 items-center justify-center rounded border transition-colors {row.shift.confirmed
																? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
																: 'border-slate-300 bg-white text-transparent hover:border-slate-400 hover:bg-slate-50'}"
															title={row.shift.confirmed ? 'Terkonfirmasi — klik untuk lepas' : 'Klik untuk konfirmasi'}
															aria-label="Konfirmasi"
														>
															{#if row.shift.confirmed}✓{:else}·{/if}
														</button>
													</form>
												</td>
											{/if}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</section>
				{/each}
			</div>
		{/each}
	</div>

	{#if visibleViews.length > 0}
		<footer class="mt-6 text-xs text-slate-500">
			Menampilkan {visibleViews.length} gereja dengan jadwal di bulan ini.
		</footer>
	{/if}
{:else}
	<!-- Unavailability tab: matrix of added volunteers × shift-bearing dates. -->
	<p class="mb-4 text-sm text-slate-600">
		Tanggal-tanggal di mana volunteer <em>tidak dapat</em> bertugas di bulan ini. Tambahkan
		satu baris untuk setiap volunteer yang melapor tidak tersedia — sel yang sudah diblokir
		oleh aturan mingguan otomatis tercentang dan terkunci, sehingga tidak perlu diduplikasi.
		Ketidakhadiran mingguan yang berulang diatur di profil masing-masing volunteer.
	</p>

	<form method="POST" action="?/saveUnavailability" use:enhance>
		<input type="hidden" name="payload" value={unavailabilityPayload} />

		{#if shiftBearingDates.length === 0}
			<p class="mb-4 rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
				Belum ada tanggal terjadwal untuk {formatMonthLabel(data.month)} — isi jadwal terlebih dahulu.
			</p>
		{:else if selectedVolunteers.length === 0}
			<p class="mb-4 rounded-md border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
				Belum ada laporan ketidakhadiran. Tambahkan volunteer di bawah jika ada yang
				memberitahu tidak dapat bertugas pada tanggal tertentu.
			</p>
		{:else}
			<div class="overflow-x-auto rounded-lg border border-slate-300 bg-white shadow-sm">
				<!--
					Unavailability matrix: first column for volunteer name, one narrow
					equal-width column per shift-bearing date, and a tight "remove"
					column at the right. We use table-auto so fixed widths below take
					effect without the last column absorbing leftover space (feedback
					2026-04-19).
				-->
				<table class="w-full text-sm">
					<colgroup>
						<col style="width: 11rem;" />
						{#each shiftBearingDates as _, i (i)}
							<col style="width: 4.5rem;" />
						{/each}
						<col style="width: 2rem;" />
					</colgroup>
					<thead>
						<tr class="border-b border-slate-300 bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
							<th class="sticky left-0 z-10 bg-slate-100 px-4 py-2 font-medium">Volunteer</th>
							{#each shiftBearingDates as d (d.date)}
								{@const sd = splitShortDate(d.date)}
								<th class="border-l border-slate-200 px-1 py-2 text-center font-normal normal-case">
									<div class="text-[11px] font-medium text-slate-800">
										{sd.weekday} {sd.d}
									</div>
									<div class="text-[10px] font-normal leading-tight text-slate-500">
										{d.label}
									</div>
								</th>
							{/each}
							<th class="px-1 py-2"></th>
						</tr>
					</thead>
					<tbody>
						{#each selectedVolunteers as v, rIdx (v.id)}
							<tr class="{rIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'} border-b border-slate-200">
								<td class="sticky left-0 z-10 bg-inherit px-4 py-2 align-top font-medium">
									{v.name}
								</td>
								{#each shiftBearingDates as d (d.date)}
									{@const e = entryFor(v.id, d.date)}
									{@const weeklyBlocked = isWeeklyBlocked(v, d.date)}
									<td class="border-l border-slate-200 px-1 py-2 text-center align-top">
										{#if weeklyBlocked}
											<input
												type="checkbox"
												checked
												disabled
												class="h-4 w-4 cursor-not-allowed opacity-70"
												title="Diblokir oleh aturan mingguan"
											/>
											<div class="mt-0.5 text-[9px] leading-tight text-slate-400">
												mingguan
											</div>
										{:else}
											<input
												type="checkbox"
												checked={hasDate(v.id, d.date)}
												onchange={() => toggleDate(v.id, d.date)}
												class="h-4 w-4"
											/>
											{#if e}
												<div class="mt-1 flex flex-col items-center gap-0.5">
													<input
														type="time"
														value={e.startTime}
														oninput={(ev) =>
															setTime(
																v.id,
																d.date,
																'startTime',
																(ev.currentTarget as HTMLInputElement).value
															)}
														class="w-full max-w-24 rounded border border-slate-300 px-1 py-0.5 text-[10px]"
														title="Diblokir dari"
													/>
													<input
														type="time"
														value={e.endTime}
														oninput={(ev) =>
															setTime(
																v.id,
																d.date,
																'endTime',
																(ev.currentTarget as HTMLInputElement).value
															)}
														class="w-full max-w-24 rounded border border-slate-300 px-1 py-0.5 text-[10px]"
														title="Diblokir sampai"
													/>
												</div>
											{/if}
										{/if}
									</td>
								{/each}
								<td class="px-1 py-2 text-right align-top">
									<button
										type="button"
										onclick={() => removeVolunteer(v.id)}
										class="text-xs text-slate-400 hover:text-rose-600"
										title="Hapus baris"
									>
										×
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if shiftBearingDates.length > 0}
			<div class="mt-4 flex flex-wrap items-center justify-between gap-3">
				<div class="flex items-center gap-2 text-sm">
					<label class="text-slate-600" for="add-vol">Tambah volunteer:</label>
					<select
						id="add-vol"
						bind:value={volunteerToAdd}
						class="rounded-md border border-slate-300 px-2 py-1 text-sm focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
					>
						<option value="">— pilih —</option>
						{#each availableToAdd as v (v.id)}
							<option value={v.id}>{v.name}</option>
						{/each}
					</select>
					<button
						type="button"
						onclick={addSelectedVolunteer}
						disabled={!volunteerToAdd}
						class="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
					>
						Tambah baris
					</button>
				</div>

				<button
					type="submit"
					class="rounded-full bg-gms-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-gms-600"
				>
					Simpan ketidakhadiran
				</button>
			</div>
		{/if}
	</form>
{/if}
