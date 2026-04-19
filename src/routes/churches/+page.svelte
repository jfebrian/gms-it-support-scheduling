<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const channelNameById = new Map(data.config.youtubeChannels.map((c) => [c.id, c.name]));
	function channelName(id: string | null): string {
		return id ? (channelNameById.get(id) ?? id) : '—';
	}
</script>

<header class="mb-6 flex items-end justify-between gap-4">
	<div>
		<p class="text-sm font-medium text-slate-500">Direktori</p>
		<h1 class="text-3xl font-bold tracking-tight">Gereja</h1>
	</div>
	<a
		href="/churches/new"
		class="rounded-md bg-gms-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-gms-600"
	>
		+ Tambah gereja
	</a>
</header>

<div class="overflow-x-auto rounded-lg border border-slate-200 bg-white">
	<table class="min-w-full text-sm">
		<thead class="bg-slate-50 text-left text-slate-600">
			<tr>
				<th class="px-4 py-2 font-medium">Nama</th>
				<th class="px-4 py-2 font-medium">Livestream</th>
				<th class="px-4 py-2 font-medium">Channel YouTube</th>
				<th class="px-4 py-2"></th>
			</tr>
		</thead>
		<tbody class="divide-y divide-slate-100">
			{#each data.config.churches as church (church.id)}
				<tr>
					<td class="px-4 py-2 font-medium">
						<span class="flex items-center gap-2">
							<span
								class="inline-block h-3 w-3 shrink-0 rounded-full"
								style="background-color: {church.color};"
								aria-hidden="true"
							></span>
							<a href="/churches/{church.id}" class="hover:text-gms-600">{church.name}</a>
						</span>
					</td>
					<td class="px-4 py-2">
						{#if church.livestream}
							<span class="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
								Livestream
							</span>
						{:else}
							<span class="text-xs text-slate-400">—</span>
						{/if}
					</td>
					<td class="px-4 py-2 text-slate-700">
						{#if church.livestream}
							{channelName(church.youtubeChannelId)}
						{:else}
							<span class="text-slate-400">—</span>
						{/if}
					</td>
					<td class="px-4 py-2 text-right">
						<a href="/churches/{church.id}" class="text-xs text-gms-600 hover:underline">
							ubah
						</a>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

