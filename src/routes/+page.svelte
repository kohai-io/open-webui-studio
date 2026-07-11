<script lang="ts">
	import CatalogueGrid from '$lib/components/CatalogueGrid.svelte';
	import { resolve } from '$app/paths';
	let { data, form } = $props();
</script>

<svelte:head
	><title>Studio · Welcome</title><meta
		name="description"
		content="Your Open WebUI Studio workspace"
	/></svelte:head
>
<main>
	<nav>
		<a class="brand" href={resolve('/')}>Studio</a><a href={resolve('/agents')}>Agents</a><a
			href={resolve('/media')}>Media</a
		><a href={resolve('/flows')}>Flows</a>{#if data.authenticated}<form
				method="POST"
				action={resolve('/auth/logout')}
			>
				<button>Sign out</button>
			</form>{/if}
	</nav>
	{#if !data.authenticated}
		<div class="hero">
			<p class="eyebrow">Open WebUI companion</p>
			<h1>Your work,<br />given room.</h1>
			<p class="lede">
				Welcome, Agents, Media, timelines, and flows—kept outside the upstream core and released on
				their own terms.
			</p>
			<a class="primary" href={resolve('/auth/login')}>Sign in</a>
		</div>
	{:else if data.state === 'ready' && data.catalogue}
		<div class="hero compact">
			<p class="eyebrow">Welcome back</p>
			<h1>{data.catalogue.user.name}</h1>
			<p class="lede">Choose an authorised agent or model and continue in Open WebUI.</p>
		</div>
		{#if form?.launchError}<p class="error">Could not open that chat: {form.launchError}</p>{/if}
		<CatalogueGrid
			eyebrow="agents"
			title="Agents ready to work"
			items={data.catalogue.agents.slice(0, 6)}
			empty="No agents are available to this account yet."
		/>
		<CatalogueGrid
			eyebrow="models"
			title="Models in reach"
			items={data.catalogue.models.slice(0, 6)}
			empty="No models are available to this account yet."
		/>
	{:else}<div class="hero compact">
			<p class="eyebrow">Studio unavailable</p>
			<h1>
				{data.state === 'permission_denied' ? 'Access denied.' : 'Open WebUI is out of reach.'}
			</h1>
			<p class="lede">
				{data.state === 'permission_denied'
					? 'Your current account cannot access this catalogue.'
					: 'Try again when the upstream service is available.'}
			</p>
		</div>{/if}
</main>

<style>
	:global(*) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		min-width: 320px;
		background:
			radial-gradient(circle at 78% 4%, rgba(110, 231, 183, 0.12), transparent 28rem), #0b0d10;
		color: #f5f7f8;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}
	main {
		width: min(72rem, calc(100% - 3rem));
		margin: auto;
		padding: 1.5rem 0 5rem;
	}
	nav {
		display: flex;
		align-items: center;
		gap: 1.25rem;
	}
	nav a,
	nav button {
		color: #aeb6bf;
		text-decoration: none;
		background: none;
		border: 0;
		font: inherit;
		cursor: pointer;
	}
	.brand {
		margin-right: auto !important;
		color: #f5f7f8 !important;
		font-weight: 750;
	}
	.hero {
		padding: clamp(5rem, 13vh, 9rem) 0 2rem;
	}
	.compact {
		padding-bottom: 0;
	}
	.eyebrow {
		color: #6ee7b7;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
	h1 {
		max-width: 60rem;
		margin: 0.5rem 0 1.5rem;
		font-size: clamp(3.5rem, 10vw, 8rem);
		font-weight: 650;
		letter-spacing: -0.075em;
		line-height: 0.95;
	}
	.lede {
		max-width: 45rem;
		color: #aeb6bf;
		font-size: clamp(1.05rem, 2vw, 1.35rem);
		line-height: 1.55;
	}
	.primary {
		display: inline-block;
		margin-top: 1.5rem;
		padding: 0.8rem 1.2rem;
		border-radius: 999px;
		background: #6ee7b7;
		color: #082a1d;
		text-decoration: none;
		font-weight: 750;
	}
	.error {
		padding: 1rem;
		border: 1px solid #743b45;
		border-radius: 0.75rem;
		background: #2b171b;
		color: #ffc5cc;
	}
	@media (max-width: 700px) {
		main {
			width: min(100% - 2rem, 72rem);
		}
	}
</style>
