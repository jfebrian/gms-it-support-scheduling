<script lang="ts">
	import { DAY_OF_WEEK_OPTIONS } from '$lib/volunteerForm';
	import type { ActionData, PageData } from './$types';
	import type { WeeklyUnavailability } from '$lib/schemas';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const v = $derived(data.volunteer);
	const vals = $derived((form?.values ?? {}) as Record<string, string>);
	const fieldErrors = $derived(form?.fieldErrors ?? {});

	// Prefer form values on validation re-render, else fall back to stored volunteer data.
	function str(key: string, fallback: string): string {
		return typeof vals[key] === 'string' ? vals[key] : fallback;
	}
	function checkedActive(): boolean {
		if (form) return form.values?.active === 'on';
		return v.active;
	}

	// Chip-toggle state for assignable churches. Reactive state drives hidden
	// inputs so the form submits as repeated `assignableChurchIds` fields
	// (matches parseVolunteerForm). This replaces the old grid-of-checkboxes,
	// which didn't scale visually.
	let assignableSet = $state<Set<string>>(new Set(v.assignableChurchIds));
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

	// Editable list of weekly unavailability rules. Travels as a JSON string
	// on submit to preserve per-rule optional time fields.
	type Rule = { dayOfWeek: WeeklyUnavailability['dayOfWeek']; startTime: string; endTime: string };
	function initialRules(): Rule[] {
		return v.weeklyUnavailability.map((r) => ({
			dayOfWeek: r.dayOfWeek,
			startTime: r.startTime ?? '',
			endTime: r.endTime ?? ''
		}));
	}
	let rules = $state<Rule[]>(initialRules());
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

<header class="mb-6 flex items-start justify-between gap-4">
	<div>
		<p class="text-sm font-medium text-slate-500">
			<a href="/volunteers" class="hover:text-gms-600">Volunteer</a> · Ubah
		</p>
		<h1 class="text-3xl font-bold tracking-tight">{v.name}</h1>
	</div>
	<div class="text-right">
		{#if v.active}
			<span class="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">Aktif</span>
		{:else}
			<span class="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-500">Tidak aktif</span>
		{/if}
	</div>
</header>

{#if form?.error}
	<div class="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
		{form.error}
	</div>
{/if}

<!--
	Deactivate / Reactivate lives outside the main save form so toggling is
	one-click and doesn't require the admin to re-validate every field. It
	sits above the form so that Save/Cancel stay at the very bottom of the
	page (the previous layout — with this panel below Save — was confusing).
-->
<section class="mb-6 max-w-2xl rounded-lg border border-slate-200 bg-white p-5">
	<div class="flex items-center justify-between gap-4">
		<div>
			<p class="text-sm font-semibold text-slate-700">
				{v.active ? 'Volunteer aktif' : 'Dinonaktifkan'}
			</p>
			<p class="mt-1 text-xs text-slate-500">
				{v.active
					? 'Menonaktifkan akan menyembunyikan volunteer ini dari penjadwal, namun riwayatnya tetap disimpan.'
					: 'Mengaktifkan kembali akan membuat volunteer ini tersedia untuk dijadwalkan.'}
			</p>
		</div>
		<form method="POST" action="/volunteers?/toggleActive">
			<input type="hidden" name="id" value={v.id} />
			<button
				type="submit"
				class="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors {v.active
					? 'border-rose-300 bg-white text-rose-600 hover:bg-rose-50'
					: 'border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50'}"
			>
				{v.active ? 'Nonaktifkan' : 'Aktifkan kembali'}
			</button>
		</form>
	</div>
</section>

<form method="POST" class="max-w-2xl space-y-5">
	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="px-1 text-sm font-semibold text-slate-700">Identitas</legend>
		<label class="block text-sm">
			<span class="mb-1 block font-medium text-slate-700">Nama</span>
			<input
				name="name"
				type="text"
				required
				value={str('name', v.name)}
				class="w-full rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
			/>
			{#if fieldErrors.name}
				<span class="mt-1 block text-xs text-rose-600">{fieldErrors.name}</span>
			{/if}
		</label>
		<label class="mt-4 flex items-center gap-2 text-sm">
			<input type="checkbox" name="active" checked={checkedActive()} class="h-4 w-4" />
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
				<option value="" selected={v.homeChurchId === null}>— tidak ada —</option>
				{#each data.config.churches as c (c.id)}
					<option value={c.id} selected={v.homeChurchId === c.id}>{c.name}</option>
				{/each}
			</select>
			{#if fieldErrors.homeChurchId}
				<span class="mt-1 block text-xs text-rose-600">{fieldErrors.homeChurchId}</span>
			{/if}
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
			<!-- Hidden inputs mirror assignableSet into the form as repeated fields. -->
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
				Kosongkan waktu untuk memblokir seluruh hari. Isi hanya waktu mulai untuk memblokir
				sejak jam tersebut, atau hanya waktu selesai untuk memblokir hingga jam tersebut.
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
			Simpan perubahan
		</button>
	</div>
</form>
