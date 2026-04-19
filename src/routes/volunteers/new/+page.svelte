<script lang="ts">
	import { DAY_OF_WEEK_OPTIONS } from '$lib/volunteerForm';
	import type { ActionData, PageData } from './$types';
	import type { WeeklyUnavailability } from '$lib/schemas';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const vals = $derived((form?.values ?? {}) as Record<string, string>);
	const fieldErrors = $derived(form?.fieldErrors ?? {});

	function val(key: string, fallback = ''): string {
		return typeof vals[key] === 'string' ? vals[key] : fallback;
	}

	// The ID field is hidden from the UI — auto-derived from the name so Joanda
	// doesn't need to think about internal keys. Collisions append -2, -3, etc.
	function slugify(s: string): string {
		return (
			s
				.toLowerCase()
				.trim()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '') || 'volunteer'
		);
	}
	const existingIds = new Set(data.config.volunteers.map((v) => v.id));
	function uniqueIdFromName(name: string): string {
		const slug = slugify(name);
		if (!existingIds.has(slug)) return slug;
		for (let n = 2; n < 1000; n++) {
			const c = `${slug}-${n}`;
			if (!existingIds.has(c)) return c;
		}
		return `${slug}-${Date.now()}`;
	}

	let name = $state(val('name'));
	const derivedId = $derived(uniqueIdFromName(name));

	// Chip-toggle state for assignable churches. New volunteers default to
	// every church selected — opting churches OUT is a deliberate action.
	let assignableSet = $state<Set<string>>(
		new Set(data.config.churches.map((c) => c.id))
	);
	const assignableList = $derived([...assignableSet]);
	function toggleChurch(id: string) {
		const next = new Set(assignableSet);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		assignableSet = next;
	}
	function selectAllChurches() {
		assignableSet = new Set(data.config.churches.map((c) => c.id));
	}
	function clearChurches() {
		assignableSet = new Set();
	}

	type Rule = { dayOfWeek: WeeklyUnavailability['dayOfWeek']; startTime: string; endTime: string };
	let rules = $state<Rule[]>([]);
	function addRule() {
		rules = [...rules, { dayOfWeek: 'sun', startTime: '', endTime: '' }];
	}
	function removeRule(i: number) {
		rules = rules.filter((_, idx) => idx !== i);
	}
	const weeklyUnavailabilityJson = $derived(
		JSON.stringify(
			rules.map((r) => {
				const out: WeeklyUnavailability = { dayOfWeek: r.dayOfWeek };
				if (r.startTime.trim()) out.startTime = r.startTime.trim();
				if (r.endTime.trim()) out.endTime = r.endTime.trim();
				return out;
			})
		)
	);
</script>

<header class="mb-6">
	<p class="text-sm font-medium text-slate-500">
		<a href="/volunteers" class="hover:text-gms-600">Volunteer</a> · Baru
	</p>
	<h1 class="text-3xl font-bold tracking-tight">Tambah volunteer</h1>
</header>

{#if form?.error}
	<div class="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
		{form.error}
	</div>
{/if}

<form method="POST" class="max-w-2xl space-y-5">
	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="px-1 text-sm font-semibold text-slate-700">Identitas</legend>
		<!-- ID is auto-generated from name — hidden input, not shown in UI. -->
		<input type="hidden" name="id" value={derivedId} />
		<label class="block text-sm">
			<span class="mb-1 block font-medium text-slate-700">Nama</span>
			<input
				name="name"
				type="text"
				required
				bind:value={name}
				class="w-full rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
			/>
			{#if fieldErrors.name}
				<span class="mt-1 block text-xs text-rose-600">{fieldErrors.name}</span>
			{/if}
		</label>
		<label class="mt-4 flex items-center gap-2 text-sm">
			<input type="checkbox" name="active" checked class="h-4 w-4" />
			<span>Aktif (jika tidak dicentang, volunteer disembunyikan dari penjadwal namun tetap tersimpan di riwayat)</span>
		</label>
	</fieldset>

	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="px-1 text-sm font-semibold text-slate-700">Gereja</legend>
		<label class="block text-sm">
			<span class="mb-1 block font-medium text-slate-700">Gereja asal (opsional)</span>
			<select
				name="homeChurchId"
				class="w-full rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
			>
				<option value="">— tidak ada —</option>
				{#each data.config.churches as c (c.id)}
					<option value={c.id} selected={val('homeChurchId') === c.id}>{c.name}</option>
				{/each}
			</select>
		</label>

		<div class="mt-4 text-sm">
			<div class="mb-2 flex items-center justify-between gap-2">
				<span class="font-medium text-slate-700">Gereja yang dapat ditugaskan</span>
				<div class="flex gap-2 text-xs">
					<button
						type="button"
						onclick={selectAllChurches}
						class="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-slate-600 hover:bg-slate-50"
					>
						Pilih semua
					</button>
					<button
						type="button"
						onclick={clearChurches}
						class="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-slate-600 hover:bg-slate-50"
					>
						Kosongkan
					</button>
				</div>
			</div>
			{#each assignableList as cid (cid)}
				<input type="hidden" name="assignableChurchIds" value={cid} />
			{/each}
			<div class="flex flex-wrap gap-2">
				{#each data.config.churches as c (c.id)}
					{@const on = assignableSet.has(c.id)}
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
			{#if fieldErrors.assignableChurchIds}
				<span class="mt-1 block text-xs text-rose-600">
					{fieldErrors.assignableChurchIds}
				</span>
			{/if}
		</div>
	</fieldset>

	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="px-1 text-sm font-semibold text-slate-700">Ketersediaan</legend>
		<div class="text-sm">
			<span class="mb-1 block font-medium text-slate-700">
				Hari tidak tersedia (berulang setiap minggu)
			</span>
			<p class="mb-2 text-xs text-slate-500">
				Kosongkan waktu untuk memblokir seluruh hari.
			</p>
			<input type="hidden" name="weeklyUnavailability" value={weeklyUnavailabilityJson} />
			{#if rules.length === 0}
				<p class="mb-2 text-xs text-slate-400">Tidak ada aturan berulang.</p>
			{/if}
			<ul class="mb-2 flex flex-col gap-2">
				{#each rules as rule, i (i)}
					<li class="flex flex-wrap items-center gap-2">
						<select
							bind:value={rule.dayOfWeek}
							class="rounded-md border border-slate-300 px-2 py-1 text-sm"
						>
							{#each DAY_OF_WEEK_OPTIONS as d (d.value)}
								<option value={d.value}>{d.label}</option>
							{/each}
						</select>
						<label class="flex items-center gap-1 text-xs text-slate-600">
							dari
							<input
								type="time"
								bind:value={rule.startTime}
								class="rounded-md border border-slate-300 px-2 py-1 text-sm"
							/>
						</label>
						<label class="flex items-center gap-1 text-xs text-slate-600">
							sampai
							<input
								type="time"
								bind:value={rule.endTime}
								class="rounded-md border border-slate-300 px-2 py-1 text-sm"
							/>
						</label>
						<button
							type="button"
							onclick={() => removeRule(i)}
							class="text-xs text-rose-600 hover:underline"
						>
							hapus
						</button>
					</li>
				{/each}
			</ul>
			<button
				type="button"
				onclick={addRule}
				class="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
			>
				+ Tambah aturan
			</button>
			{#if fieldErrors.weeklyUnavailability}
				<span class="mt-1 block text-xs text-rose-600">{fieldErrors.weeklyUnavailability}</span>
			{/if}
		</div>
	</fieldset>

	<div class="flex items-center justify-end gap-3">
		<a href="/volunteers" class="text-sm text-slate-600 hover:underline">Batal</a>
		<button
			type="submit"
			class="rounded-md bg-gms-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-gms-600"
		>
			Buat volunteer
		</button>
	</div>
</form>
