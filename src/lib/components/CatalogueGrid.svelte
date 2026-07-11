<script lang="ts">
	import type { OwuiModel } from '$lib/server/owui/contracts';
	let {
		title,
		eyebrow,
		items,
		empty
	}: { title: string; eyebrow: string; items: OwuiModel[]; empty: string } = $props();
</script>

<section aria-labelledby={`${eyebrow}-heading`}>
	<header>
		<p>{eyebrow}</p>
		<h2 id={`${eyebrow}-heading`}>{title}</h2>
	</header>
	{#if items.length}
		<div class="grid">
			{#each items as item (item.id)}
				<article>
					<div>
						<h3>{item.name}</h3>
						<p>{item.tags.length ? item.tags.join(' · ') : item.kind}</p>
					</div>
					<form method="POST" action="?/launch">
						<input type="hidden" name="modelId" value={item.id} /><button type="submit"
							>Open chat <span aria-hidden="true">↗</span></button
						>
					</form>
				</article>
			{/each}
		</div>
	{:else}<p class="empty">{empty}</p>{/if}
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
	button {
		border: 0;
		border-radius: 999px;
		padding: 0.7rem 1rem;
		background: #edfdf6;
		color: #082a1d;
		font-weight: 700;
		cursor: pointer;
	}
	button:hover {
		background: #6ee7b7;
	}
</style>
