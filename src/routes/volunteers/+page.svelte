<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const churchById = new Map(data.config.churches.map((c) => [c.id, c]));
	function churchName(id: string): string {
		return churchById.get(id)?.name ?? id;
	}
	function churchColor(id: string): string {
		return churchById.get(id)?.color ?? '#cbd5e1';
	}

	// Tri-state filter — keeps "active" default since Joanda mostly looks at the
	// current roster and only occasionally audits inactive entries.
	let filter = $state<'all' | 'active' | 'inactive'>('active');

	const filteredVolunteers = $derived(
		data.config.volunteers.filter((v) => {
			if (filter === 'active') return v.active;
			if (filter === 'inactive') return !v.active;
			return true;
		})
	);

	const FILTER_LABELS: Record<typeof filter, string> = {
		active: 'Aktif',
		all: 'Semua',
		inactive: 'Tidak aktif'
	};

	// Short day-of-week label, Bahasa. Used to summarize weekly unavailability in
	// the roster table without sending the admin to the edit page.
	const DOW_LABEL: Record<string, string> = {
		mon: 'Sen',
		tue: 'Sel',
		wed: 'Rab',
		thu: 'Kam',
		fri: 'Jum',
		sat: 'Sab',
		sun: 'Min'
	};

	function unavailabilityLabel(w: {
		dayOfWeek: string;
		startTime?: string;
		endTime?: string;
	}): string {
		const dow = DOW_LABEL[w.dayOfWeek] ?? w.dayOfWeek;
		if (w.startTime && w.endTime) return `${dow} ${w.startTime}–${w.endTime}`;
		if (w.startTime) return `${dow} dari ${w.startTime}`;
		if (w.endTime) return `${dow} sampai ${w.endTime}`;
		return dow;
	}

	const totalChurches = $derived(data.config.churches.length);
</script>

<header class="mb-6 flex items-start justify-between gap-4">
	<div>
		<p class="text-sm font-medium text-slate-500">Daftar</p>
		<h1 class="text-3xl font-bold tracking-tight">Volunteer</h1>
	</div>
	<a
		href="/volunteers/new"
		class="rounded-md bg-gms-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-gms-600"
	>
		+ Tambah volunteer
	</a>
</header>

<div class="mb-4 flex items-center gap-2 text-sm">
	<span class="text-slate-500">Tampilkan:</span>
	{#each ['active', 'all', 'inactive'] as const as opt (opt)}
		<button
			type="button"
			onclick={() => (filter = opt)}
			class="rounded-md px-2.5 py-1 transition-colors {filter === opt
				? 'bg-gms-50 font-medium text-gms-600'
				: 'text-slate-600 hover:bg-slate-100'}"
		>
			{FILTER_LABELS[opt]}
		</button>
	{/each}
	<span class="ml-auto text-slate-500">
		{filteredVolunteers.length} dari {data.config.volunteers.length}
	</span>
</div>

<div class="overflow-x-auto rounded-lg border border-slate-200 bg-white">
	<table class="min-w-full text-sm">
		<thead class="border-b border-slate-200 bg-slate-50 text-left text-slate-600">
			<tr>
				<th class="px-4 py-2 font-medium">Nama</th>
				<th class="px-4 py-2 font-medium">Gereja asal</th>
				<th class="px-4 py-2 font-medium">Gereja yang dapat ditugaskan</th>
				<th class="px-4 py-2 font-medium">Hari tidak tersedia</th>
				<th class="px-4 py-2"></th>
			</tr>
		</thead>
		<tbody class="divide-y divide-slate-200">
			{#each filteredVolunteers as v, i (v.id)}
				<tr
					class="{i % 2 === 1 ? 'bg-slate-50/60' : ''} {v.active
						? ''
						: 'text-slate-400'}"
				>
					<td class="px-4 py-1.5 font-medium align-middle">
						<div class="flex items-center gap-2">
							<a href="/volunteers/{v.id}" class="hover:text-gms-600">{v.name}</a>
							{#if !v.active}
								<span
									class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-slate-500"
								>
									Tidak aktif
								</span>
							{/if}
						</div>
					</td>
					<td class="px-4 py-1.5 align-middle">
						{#if v.homeChurchId}
							<span class="inline-flex items-center gap-2">
								<span
									class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
									style="background-color: {churchColor(v.homeChurchId)};"
									aria-hidden="true"
								></span>
								<span>{churchName(v.homeChurchId)}</span>
							</span>
						{:else}
							<span class="text-slate-400">—</span>
						{/if}
					</td>
					<td class="px-4 py-1.5 align-middle">
						{#if v.assignableChurchIds.length === 0}
							<span class="text-rose-600">tidak ada</span>
						{:else if v.assignableChurchIds.length === totalChurches}
							<span class="text-slate-400">semua ({totalChurches})</span>
						{:else}
							<span class="inline-flex flex-wrap items-center gap-1">
								{#each v.assignableChurchIds as cid (cid)}
									<span
										class="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-slate-200"
										style="background-color: {churchColor(cid)};"
										title={churchName(cid)}
										aria-label={churchName(cid)}
									></span>
								{/each}
								<span class="ml-1 text-xs text-slate-400">
									{v.assignableChurchIds.length}
								</span>
							</span>
						{/if}
					</td>
					<td class="px-4 py-1.5 align-middle">
						{#if v.weeklyUnavailability.length === 0}
							<span class="text-slate-400">—</span>
						{:else}
							<span class="inline-flex flex-wrap gap-1">
								{#each v.weeklyUnavailability as w, wi (wi)}
									<span
										class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
									>
										{unavailabilityLabel(w)}
									</span>
								{/each}
							</span>
						{/if}
					</td>
					<td class="px-4 py-1.5 text-right align-middle">
						<a
							href="/volunteers/{v.id}"
							class="text-xs text-gms-600 hover:underline"
						>
							ubah
						</a>
					</td>
				</tr>
			{/each}
			{#if filteredVolunteers.length === 0}
				<tr>
					<td colspan="5" class="px-4 py-6 text-center text-sm text-slate-500">
						Tidak ada volunteer yang sesuai dengan filter ini.
					</td>
				</tr>
			{/if}
		</tbody>
	</table>
</div>
