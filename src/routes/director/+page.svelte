<script lang="ts">
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { api, message } from '$lib/director/api';
	import '$lib/components/director/director.css';
	let { data } = $props();
	let name = $state('');
	let busy = $state(false);
	let error = $state('');
	let showArchived = $state(false);
	async function create(sourceId?: string, sourceName?: string) {
		busy = true;
		error = '';
		try {
			const project = await api('', {
				name: sourceName ? `${sourceName} copy` : name || 'Untitled project',
				...(sourceId ? { sourceId } : {})
			});
			await goto(resolve('/director/[id]', { id: project.id }));
		} catch (e) {
			error = message(e);
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Director · Studio</title></svelte:head>
<div class="director">
	<nav class="topbar">
		<a class="brand" href={resolve('/')}>Studio <span>/ Director</span></a><span class="spacer"
		></span><a href={resolve('/media')}>Media</a><a href={resolve('/flows')}>Flows</a>
	</nav>
	{#if error}<div role="alert" class="notice error">{error}</div>{/if}
	<main class="library stack">
		<p class="eyebrow">From idea to sequence</p>
		<h1>Your next production starts here.</h1>
		<p class="muted">Build a storyboard, find your characters and direct every take.</p>
		{#if !data.authenticated}<a class="button" href={resolve('/auth/login')}>Sign in to Director</a>
		{:else}
			<form
				class="row"
				onsubmit={(event) => {
					event.preventDefault();
					void create();
				}}
			>
				<label style="flex:1;max-width:420px"
					>Project name<input
						bind:value={name}
						maxlength="200"
						placeholder="A working title"
					/></label
				><button class="primary" disabled={busy} type="submit">+ New project</button>
			</form>
			<label class="check"
				><input type="checkbox" bind:checked={showArchived} /> Show archived projects</label
			>
			<div class="project-grid">
				{#each data.projects.filter((p) => showArchived || !p.archived) as project (project.id)}
					<article class="panel project-card">
						<a class="stack" href={resolve('/director/[id]', { id: project.id })}
							><span class="eyebrow"
								>{project.format || 'Production'} {project.archived ? '· Archived' : ''}</span
							>
							<h2>{project.name}</h2>
							<p class="muted">
								{project.brief.slice(0, 140) || 'An open brief. Room to explore.'}
							</p>
							<div class="row">
								<span class="pill">{project.shots.length} shots</span><span class="pill"
									>{project.ratio}</span
								><span class="pill"
									>{project.shots.reduce((sum, s) => sum + s.duration, 0)}s planned</span
								>
							</div></a
						>
						<div>
							<button class="quiet" disabled={busy} onclick={() => create(project.id, project.name)}
								>Duplicate project</button
							>
						</div>
					</article>
				{:else}<div class="empty">
						<h2>A place for every shot.</h2>
						<p class="muted">
							Create a project for a film, episode, trailer or promo. Your brief, references and
							accepted takes stay together.
						</p>
					</div>{/each}
			</div>
		{/if}
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
	}
</style>
