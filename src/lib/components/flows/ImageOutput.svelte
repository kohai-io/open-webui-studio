<script lang="ts">
	import { resolve } from '$app/paths';
	import { isFlowImages } from '$lib/flows/types';
	let { value, compact = false }: { value: unknown; compact?: boolean } = $props();
</script>

{#if isFlowImages(value)}
	<div class:compact class="images">
		{#each value.fileIds as id (id)}
			<a
				class="nodrag nopan"
				href={resolve('/media/[id]/content', { id })}
				target="_blank"
				rel="noreferrer"
				aria-label="Open generated image"
			>
				<img src={resolve('/media/[id]/content', { id })} alt="Generated result" loading="lazy" />
			</a>
		{/each}
	</div>
{/if}

<style>
	.images {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	a {
		width: 28rem;
		display: block;
		max-width: 100%;
	}
	img {
		width: 100%;
		display: block;
		max-width: 100%;
		max-height: 32rem;
		border-radius: 0.5rem;
		object-fit: contain;
	}
	.compact {
		margin-top: 0.6rem;
	}
	.compact img {
		max-height: 9rem;
		width: 11rem;
	}
</style>
