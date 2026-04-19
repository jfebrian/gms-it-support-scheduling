<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const vals = $derived((form?.values ?? {}) as Record<string, string>);
	const fieldErrors = $derived(form?.fieldErrors ?? {});

	function val(key: string, fallback = ''): string {
		return typeof vals[key] === 'string' ? vals[key] : fallback;
	}

	// Default color is a neutral slate — clearly a placeholder that nudges the
	// user to pick something distinct from the other churches. The existing
	// 7 churches use saturated mid-tones, so slate-500 reads as "not yet set".
	let name = $state(val('name'));
	let color = $state(val('color', '#64748b'));
	let livestream = $state(val('livestream') === 'on');
	let youtubeChannelId = $state(val('youtubeChannelId', ''));
</script>

<header class="mb-6">
	<p class="text-sm font-medium text-slate-500">
		<a href="/churches" class="hover:text-gms-600">Gereja</a> · Baru
	</p>
	<h1 class="text-3xl font-bold tracking-tight">Tambah gereja</h1>
</header>

{#if form?.error}
	<div class="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
		{form.error}
	</div>
{/if}

<form method="POST" class="max-w-2xl space-y-5">
	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="px-1 text-sm font-semibold text-slate-700">Info dasar</legend>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
			<label class="block text-sm">
				<span class="mb-1 block font-medium text-slate-700">Warna aksen</span>
				<div class="flex items-center gap-2">
					<input
						type="color"
						bind:value={color}
						class="h-8 w-12 shrink-0 cursor-pointer rounded-md border border-slate-300 bg-white p-0.5"
						aria-label="Pilih warna"
					/>
					<input
						name="color"
						type="text"
						bind:value={color}
						placeholder="#3b82f6"
						pattern="^#[0-9a-fA-F]{'{6}'}$"
						class="w-32 rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
					/>
				</div>
				<span class="mt-1 block text-xs text-slate-500">
					Hex <code>#RRGGBB</code>
				</span>
				{#if fieldErrors.color}
					<span class="mt-1 block text-xs text-rose-600">{fieldErrors.color}</span>
				{/if}
			</label>
		</div>

		<label class="mt-4 flex items-center gap-2 text-sm">
			<input
				type="checkbox"
				name="livestream"
				bind:checked={livestream}
				class="h-4 w-4"
			/>
			<span>
				Livestream
				<span class="block text-xs text-slate-500">
					Gereja ini mengunggah siaran ke YouTube. Gereja non-livestream memirror
					siaran gereja lain di lokasi.
				</span>
			</span>
		</label>

		{#if livestream}
			<label class="mt-4 block text-sm">
				<span class="mb-1 block font-medium text-slate-700">Channel YouTube</span>
				<select
					name="youtubeChannelId"
					bind:value={youtubeChannelId}
					class="w-full rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
				>
					<option value="">— tidak ada —</option>
					{#each data.config.youtubeChannels as ch (ch.id)}
						<option value={ch.id}>{ch.name}</option>
					{/each}
				</select>
				{#if fieldErrors.youtubeChannelId}
					<span class="mt-1 block text-xs text-rose-600">{fieldErrors.youtubeChannelId}</span>
				{/if}
			</label>
		{/if}
	</fieldset>

	<p class="text-xs text-slate-500">
		Ibadah dan shift mingguan dapat ditambahkan setelah gereja dibuat.
	</p>

	<div class="flex items-center justify-end gap-3">
		<a href="/churches" class="text-sm text-slate-600 hover:underline">Batal</a>
		<button
			type="submit"
			class="rounded-md bg-gms-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-gms-600"
		>
			Buat gereja
		</button>
	</div>
</form>
