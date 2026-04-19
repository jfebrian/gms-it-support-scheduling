<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const s = data.settings;
</script>

<header class="mb-6">
	<p class="text-sm font-medium text-slate-500">Configuration</p>
	<h1 class="text-3xl font-bold tracking-tight">Settings</h1>
</header>

{#if form?.error}
	<div class="mb-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
		{form.error}
	</div>
{/if}

<form method="POST" class="max-w-2xl space-y-5">
	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="px-1 text-sm font-semibold text-slate-700">General</legend>
		<label class="block text-sm">
			<span class="mb-1 block font-medium text-slate-700">Timezone</span>
			<input
				name="timezone"
				type="text"
				value={s.timezone}
				placeholder="Asia/Jakarta"
				class="w-full max-w-xs rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
			/>
			<span class="mt-1 block text-xs text-slate-500">
				IANA timezone name. Used for displaying times and computing week boundaries.
			</span>
		</label>
	</fieldset>

	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="px-1 text-sm font-semibold text-slate-700">Scheduling defaults</legend>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<label class="block text-sm">
				<span class="mb-1 block font-medium text-slate-700">
					Default max hours per day
				</span>
				<input
					name="defaultMaxHoursPerDay"
					type="number"
					min="0.5"
					step="0.5"
					value={s.scheduling.defaultMaxHoursPerDay}
					class="w-28 rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
				/>
			</label>
			<label class="block text-sm">
				<span class="mb-1 block font-medium text-slate-700">
					Default service duration (minutes)
				</span>
				<input
					name="defaultServiceDurationMinutes"
					type="number"
					min="1"
					value={s.scheduling.defaultServiceDurationMinutes}
					class="w-28 rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
				/>
			</label>
		</div>
	</fieldset>

	<fieldset class="rounded-lg border border-slate-200 bg-white p-5">
		<legend class="px-1 text-sm font-semibold text-slate-700">Localization</legend>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<label class="block text-sm">
				<span class="mb-1 block font-medium text-slate-700">Default locale</span>
				<input
					name="defaultLocale"
					type="text"
					value={s.i18n.defaultLocale}
					class="w-24 rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
				/>
			</label>
			<label class="block text-sm">
				<span class="mb-1 block font-medium text-slate-700">
					Supported locales (comma-separated)
				</span>
				<input
					name="supportedLocales"
					type="text"
					value={s.i18n.supportedLocales.join(', ')}
					class="w-full rounded-md border border-slate-300 px-3 py-1.5 font-mono text-sm focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
				/>
			</label>
		</div>
	</fieldset>

	<fieldset class="rounded-lg border border-slate-200 bg-white p-5 opacity-75">
		<legend class="px-1 text-sm font-semibold text-slate-700">
			YouTube monitoring
			<span class="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-normal text-slate-500">
				deferred
			</span>
		</legend>
		<p class="mb-3 text-xs text-slate-500">
			Thresholds for detecting livestream incidents. Not yet wired up — saved for later.
		</p>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
			<label class="block text-sm">
				<span class="mb-1 block font-medium text-slate-700">
					Polling interval (seconds)
				</span>
				<input
					name="pollingIntervalSeconds"
					type="number"
					min="1"
					value={s.youtube.pollingIntervalSeconds}
					class="w-28 rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
				/>
			</label>
			<label class="block text-sm">
				<span class="mb-1 block font-medium text-slate-700">
					Buffering window (seconds)
				</span>
				<input
					name="bufferingWindowSeconds"
					type="number"
					min="1"
					value={s.youtube.bufferingWindowSeconds}
					class="w-28 rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
				/>
			</label>
			<label class="block text-sm">
				<span class="mb-1 block font-medium text-slate-700">
					Buffering threshold count
				</span>
				<input
					name="bufferingThresholdCount"
					type="number"
					min="1"
					value={s.youtube.bufferingThresholdCount}
					class="w-28 rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
				/>
			</label>
			<label class="block text-sm">
				<span class="mb-1 block font-medium text-slate-700">
					Stream down grace (seconds)
				</span>
				<input
					name="streamDownGraceSeconds"
					type="number"
					min="1"
					value={s.youtube.streamDownGraceSeconds}
					class="w-28 rounded-md border border-slate-300 px-3 py-1.5 focus:border-gms-500 focus:outline-none focus:ring-1 focus:ring-gms-500"
				/>
			</label>
		</div>
	</fieldset>

	<div class="flex items-center justify-end gap-3">
		<button
			type="submit"
			class="rounded-md bg-gms-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-gms-600"
		>
			Save settings
		</button>
	</div>
</form>
