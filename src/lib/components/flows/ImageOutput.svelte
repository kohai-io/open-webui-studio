<script lang="ts">
	import { resolve } from '$app/paths';
	import { isFlowImages } from '$lib/flows/types';
	let {
		value,
		compact = false,
		onuse,
		onedit,
		disabled = false
	}: {
		value: unknown;
		compact?: boolean;
		onuse?: (id: string) => void;
		onedit?: () => void;
		disabled?: boolean;
	} = $props();
	let previewId = $state<string | null>(null);
	let dialog: HTMLDialogElement;
	function preview(id: string) {
		previewId = id;
		dialog.showModal();
	}
</script>

{#if isFlowImages(value)}
	<div class:compact class="images">
		{#each value.fileIds as id (id)}
			<div class="image-result">
				<button
					class="nodrag nopan"
					type="button"
					onclick={() => preview(id)}
					aria-label="Preview generated image"
				>
					<img src={resolve('/media/[id]/content', { id })} alt="Generated result" loading="lazy" />
				</button>
				{#if !compact}<div class="actions">
						<a href={resolve(`/media/${encodeURIComponent(id)}/content?download=1`)}>Download</a>
						{#if onuse}<button type="button" {disabled} onclick={() => onuse?.(id)}
								>Use as reference</button
							>{/if}
					</div>{/if}
			</div>
		{/each}
	</div>
	{#if !compact && onedit}<button class="edit-action" type="button" {disabled} onclick={onedit}
			>Add edit step</button
		>
		<p class="hint">Adds a step to this flow. Running it again also reruns earlier steps.</p>{/if}
{/if}

<dialog
	bind:this={dialog}
	onclose={() => (previewId = null)}
	aria-label="Image preview"
	onclick={(event) => {
		if (event.target === dialog) dialog.close();
	}}
>
	{#if previewId}<div class="preview-content">
			<header>
				<strong>Image preview</strong><button type="button" onclick={() => dialog.close()}
					>Close preview</button
				>
			</header>
			<img
				src={resolve('/media/[id]/content', { id: previewId })}
				alt="Generated result full-size preview"
			/>
			<a href={resolve(`/media/${encodeURIComponent(previewId)}/content?download=1`)}
				>Download image</a
			>
		</div>{/if}
</dialog>

<style>
	.images {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
	}
	.image-result {
		width: 28rem;
		display: block;
		max-width: 100%;
	}
	button {
		cursor: pointer;
		font: inherit;
		color: inherit;
	}
	.image-result > button {
		padding: 0;
		border: 0;
		background: transparent;
		display: block;
		width: 100%;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		margin-top: 0.6rem;
	}
	.actions a,
	.actions button,
	.edit-action,
	header button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--flow-control-height, 2.25rem);
		padding: 0.4375rem 0.75rem;
		line-height: 1.25rem;
		font-weight: 500;
		border: 1px solid #39414b;
		border-radius: var(--flow-radius, 0.375rem);
		background: #1b222a;
		color: #e4e9ed;
		font-size: var(--flow-control-font, 0.875rem);
		text-decoration: none;
	}
	.edit-action {
		margin-top: 0.9rem;
	}
	.hint {
		color: #a7b3ad;
		font-size: var(--flow-help-font, 0.75rem);
		line-height: 1.5;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	button:focus-visible,
	a:focus-visible {
		outline: 2px solid #6ee7b7;
		outline-offset: 3px;
	}
	dialog {
		max-width: min(90vw, 75rem);
		max-height: 90vh;
		border: 1px solid #40594d;
		border-radius: 1rem;
		color: #edf5f0;
		background: #111a16;
		padding: 1rem;
	}
	dialog::backdrop {
		background: #000b;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 2rem;
		margin-bottom: 1rem;
	}
	dialog img {
		max-height: 70vh;
		width: auto;
		max-width: 100%;
	}
	dialog a {
		display: inline-block;
		color: #e4e9ed;
		margin-top: 1rem;
	}
	img {
		width: 100%;
		display: block;
		max-width: 100%;
		max-height: 32rem;
		border-radius: var(--flow-radius, 0.375rem);
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
