<script lang="ts">
	import type { StudioAgent } from '$lib/server/agents/store';
	let {
		title,
		agents,
		empty,
		editable = false
	}: { title: string; agents: StudioAgent[]; empty: string; editable?: boolean } = $props();
</script>

<section aria-labelledby="agents-heading">
	<header>
		<p>agents</p>
		<h2 id="agents-heading">{title}</h2>
	</header>
	{#if agents.length}<div class="grid">
			{#each agents as agent (agent.id)}<article>
					<div>
						<h3>{agent.name}</h3>
						<p>{agent.description || `Uses ${agent.modelId}`}</p>
					</div>
					<div class="actions">
						<form method="POST" action="?/launchAgent">
							<input type="hidden" name="agentId" value={agent.id} /><button>Open chat</button>
						</form>
						{#if editable}<form method="POST" action="?/deleteAgent">
								<input type="hidden" name="agentId" value={agent.id} /><button class="secondary"
									>Delete</button
								>
							</form>{/if}
					</div>
				</article>{/each}
		</div>{:else}<p class="empty">{empty}</p>{/if}
</section>

<style>
	section {
		margin-top: 4rem;
	}
	header p {
		margin: 0;
		color: #6ee7b7;
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
	h2 {
		margin: 0.5rem 0 1.5rem;
		font-size: clamp(2rem, 5vw, 3.5rem);
		letter-spacing: -0.045em;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 1rem;
	}
	article {
		min-height: 12rem;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		padding: 1.35rem;
		border: 1px solid #2a3038;
		border-radius: 1rem;
		background: #14171c;
	}
	h3 {
		margin: 0;
		font-size: 1.2rem;
	}
	article p,
	.empty {
		color: #8f99a5;
	}
	.actions {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
	}
	button {
		border: 0;
		border-radius: 999px;
		padding: 0.7rem 1rem;
		background: #edfdf6;
		color: #082a1d;
		font-weight: 700;
		cursor: pointer;
	}
	.secondary {
		border: 1px solid #3a414b;
		background: transparent;
		color: #c7cdd4;
	}
	button:hover {
		background: #6ee7b7;
		color: #082a1d;
	}
</style>
