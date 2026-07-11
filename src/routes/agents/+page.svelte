<script lang="ts">
	import CatalogueGrid from '$lib/components/CatalogueGrid.svelte';
	import AgentGrid from '$lib/components/AgentGrid.svelte';
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
			</p>{/if}{#if form?.agentError}<p class="error">
				Could not save that agent: {form.agentError}
			</p>{/if}
		<section class="create" aria-labelledby="create-agent-heading">
			<p>New agent</p>
			<h2 id="create-agent-heading">Compose a personal launcher</h2>
			<form method="POST" action="?/createAgent">
				<label>Name <input name="name" required maxlength="80" /></label>
				<label>Description <textarea name="description" maxlength="500"></textarea></label>
				<label
					>OWUI model <select name="modelId" required
						><option value="">Choose a model</option
						>{#each data.catalogue.models as model (model.id)}<option value={model.id}
								>{model.name}</option
							>{/each}</select
					></label
				>
				<button type="submit">Create agent</button>
			</form>
		</section>
		<AgentGrid
			title="Your agents"
			agents={data.catalogue.agents}
			empty="Create your first personal agent above."
			editable
		/>
		<CatalogueGrid
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
	.create {
		margin-top: 4rem;
		padding: 1.5rem;
		border: 1px solid #2a3038;
		border-radius: 1rem;
		background: #14171c;
	}
	.create > p {
		margin: 0;
		color: #6ee7b7;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
	.create h2 {
		margin: 0.5rem 0 1.5rem;
		font-size: 2rem;
	}
	.create form {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
		gap: 1rem;
		align-items: end;
	}
	.create label {
		display: grid;
		gap: 0.4rem;
		color: #c7cdd4;
	}
	.create input,
	.create textarea,
	.create select {
		width: 100%;
		padding: 0.75rem;
		border: 1px solid #3a414b;
		border-radius: 0.6rem;
		background: #0b0d10;
		color: #f5f7f8;
	}
	.create textarea {
		min-height: 3rem;
		resize: vertical;
	}
	.create button {
		border: 0;
		border-radius: 999px;
		padding: 0.8rem 1.2rem;
		background: #6ee7b7;
		color: #082a1d;
		font-weight: 700;
		cursor: pointer;
	}
</style>
