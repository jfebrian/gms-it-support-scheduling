<script lang="ts">
	import { formatMonthLabel, parseMonth } from '$lib/dates';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const vals = $derived((form?.values ?? {}) as { name?: string; date?: string; churchIds?: string[] });

	// Default the date to the 1st of the target month — Joanda can adjust to the
	// actual event day. Pre-filled churches default to "all" (typical events
	// happen simultaneously across every church); she can uncheck exceptions.
	const defaultDate = $derived.by(() => {
		if (vals.date) return vals.date;
		const { year, month } = parseMonth(data.month);
		const mm = String(month).padStart(2, '0');
		return `${year}-${mm}-01`;
	});

	let name = $state<string>(vals.name ?? '');
	let date = $state<string>(defaultDate);
	let selectedChurches = $state<Set<string>>(
		new Set(vals.churchIds ?? data.config.churches.map((c) => c.id))
	);
	const selectedList = $derived([...selectedChurches]);

	function toggleChurch(id: string) {
		const next = new Set(selectedChurches);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedChurches = next;
	}
	function selectAll() {
		selectedChurches = new Set(data.config.churches.map((c) => c.id));
	}
	function clearAll() {
		selectedChurches = new Set();
	}

	// Month boundaries for the <input type="date"> — prevents Joanda from picking
	// a day outside this month's schedule view.
	const monthBounds = $derived.by(() => {
		const { year, month } = parseMonth(data.month);
		const mm = String(month).padStart(2, '0');
		const lastDay = new Date(year, month, 0).getDate();
		return {
			min: `${year}-${mm}-01`,
			max: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`
		};
	});
</script>

<header class="mb-6">
	<p class="text-sm font-medium text-slate-500">
		<a href="/schedule/{data.month}" class="hover:text-gms-600">
			{formatMonthLabel(data.month)}
		</a>
		· Acara baru
	</p>
	<h1 class="text-2xl font-bold tracking-tight">Tambah acara</h1>
	<p class="mt-1 text-sm text-slate-500">
		Acara seperti Jumat Agung, Natal, atau ibadah khusus. Shift mingguan dari setiap gereja
		yang dipilih akan disalin ke acara ini sebagai titik awal — volunteer dapat diatur setelah
		acara tersimpan.
	</p>
</header>

{#if form?.error}
	<div class="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
		{form.error}
	</div>
{/if}

<form method="POST" class="max-w-2xl space-y-5">
	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="px-1 text-sm font-semibold text-slate-700">Detail acara</legend>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_12rem]">
			<label class="block text-sm">
				<span class="mb-1 block font-medium text-slate-700">Nama acara</span>
				<input
					name="name"
					type="text"
					required
					bind:value={name}
					placeholder="Contoh: Ibadah Jumat Agung 2026"
					class="w-full rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
				/>
			</label>
			<label class="block text-sm">
				<span class="mb-1 block font-medium text-slate-700">Tanggal</span>
				<input
					name="date"
					type="date"
					required
					min={monthBounds.min}
					max={monthBounds.max}
					bind:value={date}
					class="w-full rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
				/>
			</label>
		</div>
	</fieldset>

	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="px-1 text-sm font-semibold text-slate-700">Gereja yang ikut serta</legend>
		<div class="mb-2 flex items-center justify-between gap-2 text-xs">
			<span class="text-slate-500">
				Shift mingguan dari masing-masing gereja akan disalin sebagai titik awal.
			</span>
			<div class="flex gap-2">
				<button
					type="button"
					onclick={selectAll}
					class="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-slate-600 hover:bg-slate-50"
				>
					Pilih semua
				</button>
				<button
					type="button"
					onclick={clearAll}
					class="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-slate-600 hover:bg-slate-50"
				>
					Kosongkan
				</button>
			</div>
		</div>
		{#each selectedList as cid (cid)}
			<input type="hidden" name="churchIds" value={cid} />
		{/each}
		<div class="flex flex-wrap gap-2">
			{#each data.config.churches as c (c.id)}
				{@const on = selectedChurches.has(c.id)}
				<button
					type="button"
					onclick={() => toggleChurch(c.id)}
					aria-pressed={on}
					class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors {on
						? 'border-slate-300 bg-white text-slate-800 shadow-sm'
						: 'border-slate-200 bg-slate-50 text-slate-400 hover:bg-slate-100'}"
				>
					<span
						class="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
						style="background-color: {on ? c.color : 'transparent'}; border: 1px solid {on ? 'transparent' : '#cbd5e1'};"
						aria-hidden="true"
					></span>
					<span>{c.name}</span>
				</button>
			{/each}
		</div>
	</fieldset>

	<div class="flex items-center justify-end gap-3">
		<a href="/schedule/{data.month}" class="text-sm text-slate-600 hover:underline">Batal</a>
		<button
			type="submit"
			class="rounded-md bg-gms-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-gms-600"
		>
			Buat acara
		</button>
	</div>
</form>
