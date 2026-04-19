<script lang="ts">
	import { formatMonthLabel } from '$lib/dates';
	import {
		buildScheduleView,
		type ChurchView,
		type DisplayItem,
		type ScheduleGroup,
		type ShiftBlock
	} from '$lib/scheduleView';
	import type { Church } from '$lib/schemas';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

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
	 * Same sort + partition as the on-screen schedule page so the shared PDF
	 * matches what Joanda sees in the app: livestream churches pinned, then
	 * heaviest-schedule churches first, LPT-balanced across two columns.
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
		return [left, right];
	});

	/**
	 * Per-row zebra (same approach as the on-screen page). Joanda called out
	 * that stripes per Ibadah row make it easier to see who's assigned where —
	 * so we flatten rowspan groups into a single index and alternate on that.
	 */
	type FlatRow = {
		group: ScheduleGroup;
		groupIdx: number;
		shift: ShiftBlock;
		shiftIdx: number;
		item: DisplayItem;
		itemIdx: number;
		isFirstOfGroup: boolean;
		isFirstOfShift: boolean;
		isLastOfShift: boolean;
		isLastOfGroup: boolean;
		groupRowspan: number;
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

	function churchStyle(church: Church): string {
		return [
			`--c-accent: ${church.color}`,
			`--c-accent-soft: color-mix(in srgb, ${church.color} 8%, transparent)`,
			`--c-zebra: color-mix(in srgb, ${church.color} 9%, transparent)`
		].join('; ');
	}
</script>

<div class="no-print mb-6 flex items-center justify-between gap-4">
	<a
		href="/schedule/{data.month}"
		class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
	>
		← Kembali ke jadwal
	</a>
	<button
		type="button"
		onclick={() => window.print()}
		class="rounded-full bg-gms-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-gms-600"
	>
		Simpan sebagai PDF
	</button>
</div>

<article class="mx-auto max-w-5xl bg-white p-8 text-slate-900 shadow-sm print:p-0 print:shadow-none">
	<!--
		Header: text-only. The previous inline SVG didn't match GMS's official
		logo font, so Joanda asked to remove it entirely (2026-04-19). The
		wordmark in the small-caps eyebrow carries the identity.
	-->
	<header class="mb-6 border-b-2 border-gms-500 pb-3">
		<p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-gms-500">
			GMS Jakarta Jawa Barat Banten — IT Support
		</p>
		<h1 class="mt-1 text-2xl font-bold tracking-tight text-slate-900">
			Jadwal {formatMonthLabel(data.month)}
		</h1>
	</header>

	<div class="grid grid-cols-1 gap-4 md:grid-cols-2 print:grid-cols-2 print:gap-3">
		{#each partitioned as column, ci (ci)}
			<div class="flex flex-col gap-4 print:gap-3">
				{#each column as view (view.church.id)}
					{@const flatRows = flattenView(view)}
					<section style={churchStyle(view.church)} class="break-inside-avoid">
						<header
							class="mb-1 flex items-baseline justify-between border-l-4 pl-2"
							style="border-left-color: var(--c-accent);"
						>
							<h2 class="text-sm font-semibold" style="color: var(--c-accent);">
								{view.church.name}
							</h2>
							{#if view.church.livestream}
								<span class="text-[9px] font-semibold uppercase tracking-wide text-slate-500">
									Livestream
								</span>
							{/if}
						</header>
						<table class="w-full border-collapse text-[11px]">
							<thead>
								<tr class="border-b-2 border-slate-400 bg-slate-100 text-left text-slate-700">
									<th class="w-32 border-r border-slate-300 px-2 py-1 font-semibold">
										Tanggal Ibadah
									</th>
									<th class="w-20 border-r border-slate-300 px-2 py-1 font-semibold">
										Ibadah
									</th>
									<th class="px-2 py-1 font-semibold">Volunteer</th>
								</tr>
							</thead>
							<tbody>
								{#each flatRows as row, rowIdx (rowIdx)}
									{@const zebra = rowIdx % 2 === 1}
									<tr
										class="align-top"
										class:border-b={!row.isLastOfGroup}
										class:border-b-slate-200={!row.isLastOfGroup && !row.isLastOfShift}
										class:border-b-slate-300={row.isLastOfShift && !row.isLastOfGroup}
										class:border-t={row.isFirstOfGroup && row.groupIdx > 0}
										class:border-t-slate-300={row.isFirstOfGroup && row.groupIdx > 0}
										style={zebra
											? 'background-color: var(--c-zebra);'
											: 'background-color: transparent;'}
									>
										{#if row.isFirstOfGroup}
											<td
												class="border-r border-slate-300 bg-white px-2 py-1 align-top"
												rowspan={row.groupRowspan}
											>
												{#if row.group.title}
													<div class="font-semibold text-slate-800">{row.group.title}</div>
												{/if}
												{#each row.group.dateLines as line (line)}
													<div
														class="text-[10px] text-slate-600"
														class:font-semibold={!row.group.title}
														class:text-slate-800={!row.group.title}
													>
														{line}
													</div>
												{/each}
											</td>
										{/if}
										<td class="border-r border-slate-300 px-2 py-1 text-slate-700">
											<span class="block">{row.item.label}</span>
											{#if row.item.startTime}
												<span class="block text-[10px] text-slate-500">{row.item.startTime}</span>
											{/if}
										</td>
										{#if row.isFirstOfShift}
											<td class="bg-white px-2 py-1" rowspan={row.shiftRowspan}>
												{#if row.shift.volunteerIds.length > 0}
													<span class="font-medium">
														{row.shift.volunteerIds.map(volName).join(', ')}
													</span>
												{:else}
													<span class="text-slate-400">—</span>
												{/if}
											</td>
										{/if}
									</tr>
								{/each}
							</tbody>
						</table>
					</section>
				{/each}
			</div>
		{/each}
	</div>

	<footer class="mt-6 border-t border-slate-200 pt-2 text-[10px] text-slate-500">
		Dibuat {new Date().toLocaleDateString('id-ID')} · GMS Jakarta Jawa Barat Banten — IT Support · {visibleViews.length}
		gereja
	</footer>
</article>

<style>
	@media print {
		:global(body) {
			background: white !important;
		}
		:global(aside),
		:global(.no-print) {
			display: none !important;
		}
		:global(main) {
			overflow: visible !important;
		}
	}
</style>
