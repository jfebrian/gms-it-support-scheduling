<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import { currentMonthYYYYMM } from '$lib/dates';

	let { children } = $props();

	const currentMonth = currentMonthYYYYMM();

	// Pages that should render without the app shell (sidebar/padding).
	// The /share schedule view needs a clean, screenshot/share-friendly layout.
	let isBareLayout = $derived(page.url.pathname.endsWith('/share'));

	type NavLink = { href: string; label: string; match: (path: string) => boolean };
	// Dashboard removed — "/" redirects to the current month's schedule, so the
	// Schedule link is the effective home. Unavailability is now a tab on the
	// Schedule page (merged 2026-04-19). Settings is hidden from nav — the
	// existing contents aren't actionable for Joanda's current workflow.
	const navLinks: NavLink[] = [
		{
			href: `/schedule/${currentMonth}`,
			label: 'Jadwal',
			match: (p) => p === '/' || p.startsWith('/schedule')
		},
		{ href: '/churches', label: 'Gereja', match: (p) => p.startsWith('/churches') },
		{ href: '/volunteers', label: 'Volunteer', match: (p) => p.startsWith('/volunteers') }
	];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>GMS IT Support</title>
</svelte:head>

{#if isBareLayout}
	<main class="min-h-screen bg-slate-50 text-slate-900">
		<div class="mx-auto max-w-5xl px-4 py-6 print:max-w-none print:px-0 print:py-0">
			{@render children()}
		</div>
	</main>
{:else}
	<div class="flex min-h-screen bg-slate-50 text-slate-900">
		<aside
			class="no-print flex w-60 flex-col bg-gms-500 px-4 py-6 text-white"
		>
			<a href="/" class="mb-8 flex items-center gap-3 text-white">
				<!--
					GMS short-mark hosted on the official site. We reference the CDN
					image directly so Joanda's browser fetches it live — our server
					can't proxy it (the CDN blocks scripted fetches), but a normal
					<img> load works fine. The wordmark carries the sub-label now
					that the logo itself supplies the "GMS" identity.
				-->
				<img
					src="https://gms.church/images/gms/short-white.svg"
					alt="GMS"
					width="40"
					height="40"
					class="h-10 w-10 shrink-0"
				/>
				<span class="block leading-tight">
					<span class="block text-sm font-semibold">IT Support</span>
					<span class="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.12em] text-white/75">
						Jakarta · Jawa Barat · Banten
					</span>
				</span>
			</a>
			<nav class="flex flex-col gap-1 text-sm">
				{#each navLinks as link (link.href)}
					{@const active = link.match(page.url.pathname)}
					<a
						href={link.href}
						class="rounded-md px-3 py-2 transition-colors {active
							? 'bg-white font-medium text-gms-500'
							: 'text-white/85 hover:bg-white/10 hover:text-white'}"
					>
						{link.label}
					</a>
				{/each}
			</nav>
			<div class="mt-auto pt-6 text-[11px] text-white/60">
				Local · git-backed<br />
				Data dir: <code class="text-white/80">data/</code>
			</div>
		</aside>

		<main class="flex-1 overflow-x-auto">
			<div class="mx-auto max-w-6xl px-8 py-8">
				{@render children()}
			</div>
		</main>
	</div>
{/if}
