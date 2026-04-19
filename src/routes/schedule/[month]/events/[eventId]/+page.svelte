<script lang="ts">
	import { formatMonthLabel, formatShortDate } from '$lib/dates';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type ShiftEdit = {
		shiftId: string;
		selected: Set<string>;
		notes: string;
		confirmed: boolean;
	};
	type BlockEdit = {
		churchId: string;
		shifts: ShiftEdit[];
	};

	function initialBlocks(): BlockEdit[] {
		return data.blocks.map((entry) => ({
			churchId: entry.block.churchId,
			shifts: entry.block.shifts.map((shift) => {
				const asg = entry.block.assignments.find((a) => a.shiftId === shift.id);
				return {
					shiftId: shift.id,
					selected: new Set(asg?.volunteerIds ?? []),
					notes: asg?.notes ?? '',
					confirmed: asg?.confirmed ?? false
				};
			})
		}));
	}

	let blocks = $state<BlockEdit[]>(initialBlocks());
	let showIneligible = $state<boolean>(false);

	function toggle(blockIdx: number, shiftIdx: number, vid: string) {
		const s = blocks[blockIdx].shifts[shiftIdx];
		if (s.selected.has(vid)) s.selected.delete(vid);
		else s.selected.add(vid);
		s.selected = new Set(s.selected);
		blocks = [...blocks];
	}

	const payload = $derived(
		JSON.stringify(
			blocks.map((b) => ({
				churchId: b.churchId,
				shifts: b.shifts.map((s) => ({
					shiftId: s.shiftId,
					volunteerIds: Array.from(s.selected),
					notes: s.notes,
					confirmed: s.confirmed
				}))
			}))
		)
	);
</script>

<header class="mb-6">
	<p class="text-sm font-medium text-slate-500">
		<a href="/schedule/{data.month}" class="hover:text-gms-600">
			{formatMonthLabel(data.month)}
		</a>
	</p>
	<h1 class="text-2xl font-bold tracking-tight">{data.event.name}</h1>
	<p class="mt-1 text-sm text-slate-500">
		{formatShortDate(data.event.date)} · {data.blocks.length}
		gereja
	</p>
</header>

{#if form?.error}
	<div class="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
		{form.error}
	</div>
{/if}

<form method="POST" class="space-y-8">
	<input type="hidden" name="payload" value={payload} />

	<div class="flex items-center justify-end text-sm">
		<label class="flex items-center gap-1.5 text-xs text-slate-500">
			<input type="checkbox" bind:checked={showIneligible} class="h-3.5 w-3.5" />
			Tampilkan yang tidak memenuhi syarat
		</label>
	</div>

	{#each data.blocks as entry, blockIdx (entry.block.churchId)}
		{@const blockState = blocks[blockIdx]}
		{@const visible = showIneligible
			? entry.classified
			: entry.classified.filter((x) => x.available)}
		<section class="space-y-4">
			<header class="flex items-baseline justify-between border-b border-slate-200 pb-1">
				<h2 class="text-lg font-semibold">
					<a href="/churches/{entry.church.id}" class="hover:text-gms-600">
						{entry.church.name}
					</a>
				</h2>
				<span class="text-xs text-slate-500">
					{entry.services.length} ibadah · {entry.block.shifts.length} shift
					{#if entry.block.services.length === 0}
						<span class="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
							ibadah default
						</span>
					{/if}
				</span>
			</header>

			{#each entry.block.shifts as shift, shiftIdx (shift.id)}
				{@const st = blockState.shifts[shiftIdx]}
				{@const count = st.selected.size}
				{@const required = shift.requiredVolunteers}
				{@const status = count === required ? 'ok' : count < required ? 'under' : 'over'}
				{@const servicesLabel = shift.serviceIds
					.map((sid) => {
						const svc = entry.services.find((s) => s.id === sid);
						return svc ? `${svc.name} · ${svc.startTime}` : sid;
					})
					.join(', ')}
				<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
					<legend class="flex items-center gap-2 px-1 text-sm font-semibold text-slate-700">
						{shift.label ?? shift.id}
						<span class="text-xs font-normal text-slate-500">
							· {servicesLabel}
						</span>
						<span
							class="ml-auto rounded px-2 py-0.5 text-xs {status === 'ok'
								? 'bg-emerald-50 text-emerald-700'
								: status === 'under'
									? 'bg-amber-50 text-amber-700'
									: 'bg-rose-50 text-rose-700'}"
						>
							{count} / {required}
						</span>
					</legend>

					<div class="grid grid-cols-1 gap-1 sm:grid-cols-2">
						{#each visible as row (row.volunteer.id)}
							<label
								class="flex items-center gap-2 rounded-md px-2 py-1 text-sm {row.available
									? 'hover:bg-slate-50'
									: 'opacity-60'}"
							>
								<input
									type="checkbox"
									checked={st.selected.has(row.volunteer.id)}
									onchange={() => toggle(blockIdx, shiftIdx, row.volunteer.id)}
									class="h-4 w-4"
								/>
								<span class="flex-1">{row.volunteer.name}</span>
								{#if !row.available}
									<span class="text-xs text-rose-500">{row.reason}</span>
								{/if}
							</label>
						{/each}
						{#if visible.length === 0}
							<p class="col-span-full py-2 text-sm text-slate-500">Tidak ada volunteer yang cocok.</p>
						{/if}
					</div>

					<div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
						<label class="block text-sm sm:col-span-2">
							<span class="mb-1 block text-xs font-medium text-slate-500">Catatan</span>
							<input
								type="text"
								bind:value={st.notes}
								class="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
							/>
						</label>
						<label class="flex items-center gap-2 self-end text-xs text-slate-500">
							<input
								type="checkbox"
								bind:checked={st.confirmed}
								class="h-4 w-4"
							/>
							<span>Terkonfirmasi (kunci dari pengacakan)</span>
						</label>
					</div>
				</fieldset>
			{/each}
		</section>
	{/each}

	<div class="flex items-center justify-end gap-3">
		<a href="/schedule/{data.month}" class="text-sm text-slate-600 hover:underline">Batal</a>
		<button
			type="submit"
			class="rounded-md bg-gms-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-gms-600"
		>
			Simpan penugasan acara
		</button>
	</div>
</form>
