<script lang="ts">
	import CatalogueGrid from '$lib/components/CatalogueGrid.svelte';
	import { resolve } from '$app/paths';
	let { data, form } = $props();
	const loginHref = resolve(`/auth/login?return=${encodeURIComponent(resolve('/agents'))}`);
</script>

<svelte:head><title>Studio · Agents</title></svelte:head>
<main>
	<nav><a href={resolve('/')}>← Welcome</a></nav>
	<header>
		<p>Catalogue</p>
		<h1>Agents & models</h1>
	</header>
	{#if !data.authenticated}<p>
			Please <a href={loginHref}>sign in</a> to view your catalogue.
		</p>
	{:else if data.state === 'ready' && data.catalogue}{#if form?.launchError}<p class="error">
				Could not open that chat: {form.launchError}
			</p>{/if}<CatalogueGrid
			eyebrow="agents"
			title="Authorised agents"
			items={data.catalogue.agents}
			empty="No agents are available to this account."
		/><CatalogueGrid
			eyebrow="models"
			title="Authorised models"
			items={data.catalogue.models}
			empty="No models are available to this account."
		/>
	{:else}<p>
			{data.state === 'permission_denied'
				? 'Catalogue access denied.'
				: 'Open WebUI is currently unavailable.'}
		</p>{/if}
</main>

<style>
	:global(body) {
		margin: 0;
		background: #0b0d10;
		color: #f5f7f8;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}
	main {
		width: min(72rem, calc(100% - 3rem));
		margin: auto;
		padding: 2rem 0 5rem;
	}
	a {
		color: #6ee7b7;
	}
	header {
		padding: 5rem 0 0;
	}
	header p {
		color: #6ee7b7;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0.5rem 0;
		font-size: clamp(3rem, 8vw, 6rem);
		letter-spacing: -0.065em;
	}
	.error {
		color: #ffc5cc;
	}
</style>
