<script lang="ts">
	import type { ActionData, PageData } from './$types';
	import type {
		Church as ChurchT,
		DayOfWeek,
		ServiceTemplate,
		ShiftTemplate
	} from '$lib/schemas';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Day picker labels — Bahasa Indonesia short form, stable order Mon→Sun
	// since schedules read chronologically.
	const DAYS: Array<{ value: DayOfWeek; label: string }> = [
		{ value: 'mon', label: 'Sen' },
		{ value: 'tue', label: 'Sel' },
		{ value: 'wed', label: 'Rab' },
		{ value: 'thu', label: 'Kam' },
		{ value: 'fri', label: 'Jum' },
		{ value: 'sat', label: 'Sab' },
		{ value: 'sun', label: 'Min' }
	];

	// Deep-clone into reactive state so we can mutate freely without writing
	// through to the original PageData snapshot.
	let working = $state<ChurchT>(structuredClone($state.snapshot(data.church)));

	/**
	 * Derive a stable machine id from a human-entered name. The ID is hidden from
	 * the UI (Joanda: "these should just be a key in the data"); we compute it
	 * automatically from the name + a disambiguator so referential integrity still
	 * works between services and shifts.
	 */
	function slugify(s: string): string {
		return (
			s
				.toLowerCase()
				.trim()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '') || 'item'
		);
	}
	function uniqueId(base: string, existing: ReadonlyArray<{ id: string }>, skipIdx?: number): string {
		const slug = slugify(base);
		const taken = new Set(
			existing.filter((_, i) => i !== skipIdx).map((e) => e.id)
		);
		if (!taken.has(slug)) return slug;
		for (let n = 2; n < 1000; n++) {
			const candidate = `${slug}-${n}`;
			if (!taken.has(candidate)) return candidate;
		}
		return `${slug}-${Date.now()}`;
	}

	function addService() {
		const baseName = 'Ibadah baru';
		const s: ServiceTemplate = {
			id: uniqueId(baseName, working.weeklyServices),
			dayOfWeek: 'sun',
			startTime: '09:00',
			name: baseName,
			requiresItSupport: true
		};
		working.weeklyServices = [...working.weeklyServices, s];
	}
	function renameService(idx: number, name: string) {
		const old = working.weeklyServices[idx];
		const newId = uniqueId(name, working.weeklyServices, idx);
		// Rewrite references in shifts so shift.serviceIds stays consistent.
		working.weeklyShifts = working.weeklyShifts.map((sh) => ({
			...sh,
			serviceIds: sh.serviceIds.map((sid) => (sid === old.id ? newId : sid))
		}));
		working.weeklyServices[idx] = { ...old, id: newId, name };
	}
	function removeService(idx: number) {
		const svc = working.weeklyServices[idx];
		working.weeklyServices = working.weeklyServices.filter((_, i) => i !== idx);
		working.weeklyShifts = working.weeklyShifts.map((sh) => ({
			...sh,
			serviceIds: sh.serviceIds.filter((sid) => sid !== svc.id)
		}));
	}

	function addShift() {
		const baseName = `Shift ${working.weeklyShifts.length + 1}`;
		const sh: ShiftTemplate = {
			id: uniqueId(baseName, working.weeklyShifts),
			label: baseName,
			serviceIds: [],
			requiredVolunteers: 1,
			weeks: []
		};
		working.weeklyShifts = [...working.weeklyShifts, sh];
	}

	// Week chips: empty = every week. Toggling a chip adds/removes that week
	// from the whitelist. When the user unchecks the last chip we go back to
	// [] (all weeks) — that's the only reasonable default.
	const WEEKS: ReadonlyArray<1 | 2 | 3 | 4 | 5> = [1, 2, 3, 4, 5];
	function toggleShiftWeek(shiftIdx: number, w: 1 | 2 | 3 | 4 | 5) {
		const sh = working.weeklyShifts[shiftIdx];
		const current = sh.weeks ?? [];
		const has = current.includes(w);
		const next = has ? current.filter((x) => x !== w) : [...current, w].sort((a, b) => a - b);
		working.weeklyShifts[shiftIdx] = { ...sh, weeks: next };
	}
	function renameShift(idx: number, label: string) {
		const old = working.weeklyShifts[idx];
		const newId = uniqueId(label, working.weeklyShifts, idx);
		working.weeklyShifts[idx] = { ...old, id: newId, label };
	}
	function removeShift(idx: number) {
		working.weeklyShifts = working.weeklyShifts.filter((_, i) => i !== idx);
	}
	function toggleShiftService(shiftIdx: number, svcId: string) {
		const sh = working.weeklyShifts[shiftIdx];
		const has = sh.serviceIds.includes(svcId);
		working.weeklyShifts[shiftIdx] = {
			...sh,
			serviceIds: has ? sh.serviceIds.filter((s) => s !== svcId) : [...sh.serviceIds, svcId]
		};
	}

	const payload = $derived(JSON.stringify($state.snapshot(working)));
</script>

<header class="mb-6 flex items-start justify-between gap-4">
	<div>
		<p class="text-sm font-medium text-slate-500">
			<a href="/churches" class="hover:text-gms-600">Gereja</a> · Ubah
		</p>
		<h1 class="text-3xl font-bold tracking-tight">{data.church.name}</h1>
	</div>
</header>

{#if form?.error}
	<div class="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
		{form.error}
		{#if form.issues && form.issues.length > 0}
			<ul class="mt-1 list-inside list-disc text-xs">
				{#each form.issues as iss (iss.path.join('.'))}
					<li><code>{iss.path.join('.')}</code>: {iss.message}</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<form method="POST" action="?/update" class="space-y-6">
	<input type="hidden" name="payload" value={payload} />

	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="px-1 text-sm font-semibold text-slate-700">Info dasar</legend>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<label class="block text-sm">
				<span class="mb-1 block font-medium text-slate-700">Nama</span>
				<input
					type="text"
					bind:value={working.name}
					class="w-full rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
				/>
			</label>
			<label class="block text-sm">
				<span class="mb-1 block font-medium text-slate-700">Warna aksen</span>
				<div class="flex items-center gap-2">
					<!--
						Native color picker bound to the hex string. We also render a
						read-only text mirror so Joanda can see/share the hex value and
						paste it if she wants to reuse it elsewhere (feedback 2026-04-19).
					-->
					<input
						type="color"
						bind:value={working.color}
						class="h-8 w-12 shrink-0 cursor-pointer rounded-md border border-slate-300 bg-white p-0.5"
						aria-label="Pilih warna"
					/>
					<input
						type="text"
						bind:value={working.color}
						placeholder="#3b82f6"
						pattern="^#[0-9a-fA-F]{'{6}'}$"
						class="w-32 rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
					/>
				</div>
				<span class="mt-1 block text-xs text-slate-500">
					Hex <code>#RRGGBB</code>
				</span>
			</label>
			<label class="flex items-center gap-2 self-end text-sm sm:col-span-2">
				<input type="checkbox" bind:checked={working.livestream} class="h-4 w-4" />
				<span>
					Livestream
					<span class="block text-xs text-slate-500">
						Gereja ini mengunggah siaran ke YouTube. Gereja non-livestream memirror
						siaran gereja lain di lokasi.
					</span>
				</span>
			</label>
			{#if working.livestream}
				<label class="block text-sm sm:col-span-2">
					<span class="mb-1 block font-medium text-slate-700">Channel YouTube</span>
					<select
						value={working.youtubeChannelId ?? ''}
						onchange={(e) => {
							const v = (e.currentTarget as HTMLSelectElement).value;
							working.youtubeChannelId = v === '' ? null : v;
						}}
						class="w-full rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
					>
						<option value="">— tidak ada —</option>
						{#each data.config.youtubeChannels as ch (ch.id)}
							<option value={ch.id}>{ch.name}</option>
						{/each}
					</select>
				</label>
			{/if}
		</div>
	</fieldset>

	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="flex items-center gap-2 px-1 text-sm font-semibold text-slate-700">
			Ibadah mingguan
			<button
				type="button"
				onclick={addService}
				class="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
			>
				+ tambah
			</button>
		</legend>

		{#if working.weeklyServices.length === 0}
			<p class="text-sm text-slate-500">Belum ada ibadah mingguan.</p>
		{:else}
			<!--
				Card-per-service layout rather than the old table. The hero fields are
				name + day + start time; everything else (the IT Support toggle) trails
				on a second line. This is the shape Joanda drew on paper.
			-->
			<ul class="flex flex-col gap-2">
				{#each working.weeklyServices as svc, i (svc.id)}
					<li class="rounded-md border border-slate-200 bg-slate-50/50 p-3">
						<div class="flex flex-wrap items-end gap-3">
							<label class="block flex-1 text-sm" style="min-width: 14rem;">
								<span class="mb-1 block text-xs font-medium text-slate-500">Nama</span>
								<input
									type="text"
									value={svc.name}
									oninput={(e) => renameService(i, (e.currentTarget as HTMLInputElement).value)}
									class="w-full rounded-md border border-slate-300 px-2 py-1"
								/>
							</label>
							<label class="block text-sm">
								<span class="mb-1 block text-xs font-medium text-slate-500">Hari</span>
								<select
									bind:value={svc.dayOfWeek}
									class="rounded-md border border-slate-300 px-2 py-1"
								>
									{#each DAYS as d (d.value)}
										<option value={d.value}>{d.label}</option>
									{/each}
								</select>
							</label>
							<label class="block text-sm">
								<span class="mb-1 block text-xs font-medium text-slate-500">Mulai</span>
								<input
									type="time"
									bind:value={svc.startTime}
									class="w-28 rounded-md border border-slate-300 px-2 py-1 font-mono"
								/>
							</label>
							<button
								type="button"
								onclick={() => removeService(i)}
								class="text-xs text-rose-600 hover:underline"
								aria-label="Hapus ibadah"
							>
								hapus
							</button>
						</div>
						<label class="mt-2 flex items-center gap-2 text-sm">
							<input
								type="checkbox"
								bind:checked={svc.requiresItSupport}
								class="h-4 w-4"
							/>
							<span class="text-slate-700">IT Support</span>
						</label>
					</li>
				{/each}
			</ul>
		{/if}
	</fieldset>

	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="flex items-center gap-2 px-1 text-sm font-semibold text-slate-700">
			Shift mingguan
			<button
				type="button"
				onclick={addShift}
				class="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50"
			>
				+ tambah
			</button>
		</legend>
		<p class="mb-3 text-xs text-slate-500">
			Satu shift dicover oleh satu volunteer. Pilih ibadah apa saja yang
			termasuk dalam shift ini dengan mengklik chipnya.
		</p>

		{#if working.weeklyShifts.length === 0}
			<p class="text-sm text-slate-500">Belum ada shift mingguan.</p>
		{:else}
			<div class="flex flex-col gap-3">
				{#each working.weeklyShifts as sh, i (sh.id)}
					<div class="rounded-md border border-slate-200 p-3">
						<div class="flex flex-wrap items-end gap-3">
							<label class="block flex-1 text-sm" style="min-width: 14rem;">
								<span class="mb-1 block text-xs font-medium text-slate-500">Nama shift</span>
								<input
									type="text"
									value={sh.label ?? ''}
									oninput={(e) =>
										renameShift(i, (e.currentTarget as HTMLInputElement).value)}
									class="w-full rounded-md border border-slate-300 px-2 py-1"
								/>
							</label>
							<label class="block text-sm">
								<span class="mb-1 block text-xs font-medium text-slate-500">
									Volunteer dibutuhkan
								</span>
								<input
									type="number"
									min="1"
									bind:value={sh.requiredVolunteers}
									class="w-24 rounded-md border border-slate-300 px-2 py-1"
								/>
							</label>
							<button
								type="button"
								onclick={() => removeShift(i)}
								class="text-xs text-rose-600 hover:underline"
							>
								hapus shift
							</button>
						</div>
						<div class="mt-3">
							<span class="mb-1 block text-xs font-medium text-slate-500">
								Minggu ke-berapa
							</span>
							<!--
								Week-of-month filter. Empty selection = shift applies every week
								(the common case and the default for existing shifts). Pinning
								to specific weeks is for things like "first Sunday only" EK
								Voltage etc. (feedback 2026-04-19).
							-->
							<div class="flex flex-wrap items-center gap-2">
								{#each WEEKS as w (w)}
									{@const on = (sh.weeks ?? []).includes(w)}
									<button
										type="button"
										onclick={() => toggleShiftWeek(i, w)}
										aria-pressed={on}
										class="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full border px-2 text-xs transition-colors {on
											? 'border-gms-500 bg-gms-50 text-gms-700 shadow-sm'
											: 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}"
									>
										{w}
									</button>
								{/each}
								<span class="text-[11px] text-slate-400">
									{#if (sh.weeks ?? []).length === 0}
										· setiap minggu
									{:else}
										· hanya minggu ke-{(sh.weeks ?? []).join(', ')}
									{/if}
								</span>
							</div>
						</div>
						<div class="mt-3">
							<span class="mb-1 block text-xs font-medium text-slate-500">
								Ibadah yang dicover
							</span>
							{#if working.weeklyServices.length === 0}
								<p class="text-xs text-slate-400">Tambahkan ibadah terlebih dahulu.</p>
							{:else}
								<!--
									Chip picker keyed on the service NAME (not the hidden id) so
									Joanda stops reading "umum-1/umum-2/..." and instead sees
									"Umum 1 · 07:00 · Min".

									Only services flagged "IT Support" are offered here — a
									weekly shift IS an IT Support rotation, so services that
									don't use IT support (EK kids ministries etc.) shouldn't
									show up as candidates and clutter the picker. If a stale
									selection exists (service was flagged no-IT *after* being
									added to a shift), we still render it — styled as a warning
									— so the user can see + remove it.
								-->
								{@const eligibleServices = working.weeklyServices.filter((s) => s.requiresItSupport)}
								{@const stalePicks = working.weeklyServices.filter(
									(s) => !s.requiresItSupport && sh.serviceIds.includes(s.id)
								)}
								{#if eligibleServices.length === 0 && stalePicks.length === 0}
									<p class="text-xs text-slate-400">
										Tidak ada ibadah dengan flag IT Support. Aktifkan flag
										"IT Support" pada ibadah di atas untuk menjadikannya
										dapat dipilih.
									</p>
								{:else}
									<div class="flex flex-wrap gap-2">
										{#each eligibleServices as svc (svc.id)}
											{@const on = sh.serviceIds.includes(svc.id)}
											{@const dayLabel = DAYS.find((d) => d.value === svc.dayOfWeek)?.label ?? svc.dayOfWeek}
											<button
												type="button"
												onclick={() => toggleShiftService(i, svc.id)}
												aria-pressed={on}
												class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors {on
													? 'border-gms-500 bg-gms-50 text-gms-700 shadow-sm'
													: 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}"
											>
												<span class="font-medium">{svc.name}</span>
												<span class="text-slate-400">·</span>
												<span class="font-mono text-[10px]">{svc.startTime}</span>
												<span class="text-slate-400">·</span>
												<span>{dayLabel}</span>
											</button>
										{/each}
										{#each stalePicks as svc (svc.id)}
											{@const dayLabel = DAYS.find((d) => d.value === svc.dayOfWeek)?.label ?? svc.dayOfWeek}
											<button
												type="button"
												onclick={() => toggleShiftService(i, svc.id)}
												aria-pressed={true}
												title="Ibadah ini tidak bertanda IT Support — klik untuk melepas dari shift"
												class="inline-flex items-center gap-1.5 rounded-full border border-amber-400 bg-amber-50 px-2.5 py-1 text-xs text-amber-800 shadow-sm hover:bg-amber-100"
											>
												<span class="font-medium">{svc.name}</span>
												<span class="text-amber-400">·</span>
												<span class="font-mono text-[10px]">{svc.startTime}</span>
												<span class="text-amber-400">·</span>
												<span>{dayLabel}</span>
												<span class="text-amber-600">·</span>
												<span class="text-[10px] uppercase tracking-wide">tanpa IT</span>
											</button>
										{/each}
									</div>
									<p class="mt-2 text-[11px] text-slate-400">
										Hanya ibadah dengan flag IT Support yang muncul di sini.
									</p>
								{/if}
							{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</fieldset>

	<div class="flex items-center justify-end gap-3">
		<a href="/churches" class="text-sm text-slate-600 hover:underline">Batal</a>
		<button
			type="submit"
			class="rounded-md bg-gms-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-gms-600"
		>
			Simpan perubahan
		</button>
	</div>
</form>

<!--
	Danger zone — separate <form> so deletion can't be triggered by an Enter
	keypress inside the main editor, and so a failed delete doesn't take the
	in-progress edits above with it. The server action also strips this
	church from any volunteer's homeChurchId / assignableChurchIds and from
	YouTube channels' servesChurchIds, otherwise loadAppConfig's cross-ref
	check would fail on the next page load.
-->
<section class="mt-8 rounded-lg border border-rose-200 bg-rose-50/40 p-5">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div>
			<p class="text-sm font-semibold text-rose-700">Hapus gereja</p>
			<p class="mt-1 text-xs text-slate-600">
				Menghapus akan menghilangkan {data.church.name} dari aplikasi dan
				membersihkan referensinya di profil volunteer dan channel YouTube.
				Riwayat penjadwalan tetap tersimpan. Tindakan ini tidak dapat
				dibatalkan.
			</p>
		</div>
		<form
			method="POST"
			action="?/delete"
			onsubmit={(e) => {
				if (
					!confirm(
						`Hapus gereja "${data.church.name}" secara permanen? Referensinya akan dihapus dari profil volunteer.`
					)
				) {
					e.preventDefault();
				}
			}}
		>
			<button
				type="submit"
				class="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-100"
			>
				Hapus gereja
			</button>
		</form>
	</div>
</section>
