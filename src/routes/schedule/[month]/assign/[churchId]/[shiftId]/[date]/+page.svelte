<script lang="ts">
	import { formatMonthLabel, formatShortDate } from '$lib/dates';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const required = data.shift.requiredVolunteers;
	const shiftLabel = data.shift.label ?? data.shift.id;

	// Pretty-print the services this shift covers — show name + start time
	// instead of raw ids like "umum-1".
	const servicesLabel = data.shift.serviceIds
		.map((sid) => {
			const svc = data.church.weeklyServices.find((s) => s.id === sid);
			return svc ? `${svc.name} · ${svc.startTime}` : sid;
		})
		.join(', ');

	// Start from current assignment's volunteerIds if present; else empty.
	let selected = $state<Set<string>>(new Set(data.current?.volunteerIds ?? []));
	let notes = $state<string>(data.current?.notes ?? '');
	let confirmed = $state<boolean>(data.current?.confirmed ?? false);
	let showIneligible = $state<boolean>(false);

	function toggle(id: string) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
		selected = new Set(selected);
	}

	const visible = $derived(
		showIneligible ? data.classified : data.classified.filter((x) => x.available)
	);

	const count = $derived(selected.size);
	const overOrUnder = $derived(count === required ? 'ok' : count < required ? 'under' : 'over');
</script>

<header class="mb-6">
	<p class="text-sm font-medium text-slate-500">
		<a href="/schedule/{data.month}" class="hover:text-gms-600">
			{formatMonthLabel(data.month)}
		</a>
		·
		<a href="/churches/{data.church.id}" class="hover:text-gms-600">{data.church.name}</a>
	</p>
	<h1 class="text-2xl font-bold tracking-tight">
		{shiftLabel} · {formatShortDate(data.date)}
	</h1>
	<p class="mt-1 text-sm text-slate-500">
		Ibadah: {servicesLabel}
		<span class="mx-2 text-slate-300">·</span>
		Butuh {required} volunteer
	</p>
</header>

{#if form?.error}
	<div class="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
		{form.error}
	</div>
{/if}

<form method="POST" class="max-w-3xl space-y-5">
	{#each [...selected] as id (id)}
		<input type="hidden" name="volunteerIds" value={id} />
	{/each}

	<div
		class="rounded-lg border p-3 text-sm {overOrUnder === 'ok'
			? 'border-emerald-200 bg-emerald-50 text-emerald-800'
			: overOrUnder === 'under'
				? 'border-amber-200 bg-amber-50 text-amber-800'
				: 'border-rose-200 bg-rose-50 text-rose-800'}"
	>
		Dipilih {count} / {required}
		{#if overOrUnder === 'under'}· butuh {required - count} lagi{/if}
		{#if overOrUnder === 'over'}· kelebihan {count - required}{/if}
	</div>

	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="flex items-center gap-2 px-1 text-sm font-semibold text-slate-700">
			Volunteer
			<label class="ml-auto flex items-center gap-1.5 text-xs font-normal text-slate-500">
				<input type="checkbox" bind:checked={showIneligible} class="h-3.5 w-3.5" />
				Tampilkan yang tidak memenuhi syarat
			</label>
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
						checked={selected.has(row.volunteer.id)}
						onchange={() => toggle(row.volunteer.id)}
						class="h-4 w-4"
					/>
					<span class="flex-1">{row.volunteer.name}</span>
					{#if !row.available}
						<span class="text-xs text-rose-500">{row.reason}</span>
					{/if}
				</label>
			{/each}
			{#if visible.length === 0}
				<p class="col-span-full py-2 text-sm text-slate-500">
					Tidak ada volunteer yang cocok. Aktifkan "Tampilkan yang tidak memenuhi syarat" untuk melihat semua.
				</p>
			{/if}
		</div>
	</fieldset>

	<label class="block text-sm">
		<span class="mb-1 block font-medium text-slate-700">Catatan</span>
		<textarea
			name="notes"
			rows="2"
			bind:value={notes}
			class="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
		></textarea>
	</label>

	<label class="flex items-center gap-2 text-sm">
		<input type="checkbox" name="confirmed" bind:checked={confirmed} class="h-4 w-4" />
		<span>
			Terkonfirmasi
			<span class="text-xs text-slate-500">
				(mengunci slot ini agar tidak diacak)
			</span>
		</span>
	</label>

	<div class="flex items-center justify-end gap-3">
		<a href="/schedule/{data.month}" class="text-sm text-slate-600 hover:underline">Batal</a>
		<button
			type="submit"
			class="rounded-md bg-gms-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-gms-600"
		>
			Simpan penugasan
		</button>
	</div>
</form>
