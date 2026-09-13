<script lang="ts">
	import { resolve } from '$app/paths';
	import { isFlowImages, type FlowImages, type FlowInputValue } from '$lib/flows/types';
	import SketchInput from './SketchInput.svelte';
	let {
		value,
		onchange,
		disabled = false,
		onbusy = () => {}
	}: {
		value: FlowInputValue | undefined;
		onchange: (value: FlowImages) => void;
		disabled?: boolean;
		onbusy?: (busy: boolean) => void;
	} = $props();
	let ids = $derived(isFlowImages(value) ? value.fileIds : []);
	let busy = $state(false);
	let error = $state('');
	let showSketch = $state(false);
	let showLibrary = $state(false);
	let library = $state<{ id: string; filename: string }[]>([]);
	let nextCursor = $state<string | null>(null);
	const url = (id: string) => resolve('/media/[id]/content', { id });
	async function upload(file: File) {
		if (ids.length >= 8) {
			error = 'Use up to eight reference images.';
			return;
		}
		busy = true;
		onbusy(true);
		error = '';
		try {
			const body = new FormData();
			body.append('file', file);
			const response = await fetch(resolve('/api/flow-media'), { method: 'POST', body });
			if (!response.ok)
				throw new Error('Upload failed. Use a PNG, JPEG or WebP image up to 10 MB.');
			const image = await response.json();
			if (!isFlowImages(image)) throw new Error('The image could not be saved.');
			onchange({ kind: 'images', fileIds: [...ids, ...image.fileIds] });
		} catch (e) {
			error = e instanceof Error ? e.message : 'Upload failed';
			throw e;
		} finally {
			busy = false;
			onbusy(false);
		}
	}
	async function chooseFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		for (const file of Array.from(input.files ?? [])) {
			try {
				await upload(file);
			} catch {
				break;
			}
		}
		input.value = '';
	}
	async function browse(more = false) {
		error = '';
		try {
			const response = await fetch(
				resolve('/api/flow-media') +
					(more && nextCursor ? '?cursor=' + encodeURIComponent(nextCursor) : '')
			);
			if (!response.ok) throw new Error('Could not load your images.');
			const page = await response.json();
			library = more ? [...library, ...page.items] : page.items;
			nextCursor = page.nextCursor;
			showLibrary = true;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not load images';
		}
	}
</script>

<div class="image-input">
	<div class="actions">
		<label
			>Upload images <input
				type="file"
				accept="image/png,image/jpeg,image/webp"
				multiple
				disabled={disabled || busy || ids.length >= 8}
				onchange={chooseFiles}
			/></label
		><button type="button" disabled={disabled || busy} onclick={() => browse()}
			>Choose from Media</button
		><button type="button" disabled={disabled || busy} onclick={() => (showSketch = !showSketch)}
			>{showSketch ? 'Hide sketch' : 'Draw a sketch'}</button
		>
	</div>
	{#if busy}<p role="status">Saving image...</p>{/if}
	{#if error}<p role="alert">{error}</p>{/if}
	<div class="references">
		{#each ids as id (id)}<div>
				<img src={url(id)} alt="Selected reference" /><button
					type="button"
					disabled={disabled || busy}
					aria-label="Remove reference"
					onclick={() => onchange({ kind: 'images', fileIds: ids.filter((item) => item !== id) })}
					>Remove</button
				>
			</div>{/each}
	</div>
	{#if showLibrary}<div class="library">
			<strong>Your images</strong><button type="button" onclick={() => (showLibrary = false)}
				>Close Media picker</button
			>
			<div class="references">
				{#each library as item (item.id)}<button
						type="button"
						disabled={disabled || busy || ids.includes(item.id) || ids.length >= 8}
						onclick={() => onchange({ kind: 'images', fileIds: [...ids, item.id] })}
						><img src={url(item.id)} alt={item.filename} /><span>{item.filename}</span></button
					>{/each}
			</div>
			{#if nextCursor}<button type="button" onclick={() => browse(true)}>Load more images</button
				>{/if}{#if !library.length}<p>
					No images on this page. Upload an image or draw a sketch.
				</p>{/if}
		</div>{/if}
	{#if showSketch}<SketchInput
			disabled={disabled || busy || ids.length >= 8}
			onsave={upload}
		/>{/if}
	<small>{ids.length}/8 references. Each image is sent separately to the editing model.</small>
</div>

<style>
	.image-input {
		display: grid;
		gap: 0.8rem;
	}
	.actions,
	.references {
		display: flex;
		flex-wrap: wrap;
		gap: 0.7rem;
		align-items: center;
	}
	.references img {
		width: 7rem;
		height: 7rem;
		object-fit: contain;
		border-radius: 0.4rem;
	}
	.references > div,
	.references > button {
		display: grid;
		gap: 0.3rem;
	}
	.references span {
		max-width: 8rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	button {
		border: 1px solid #39414b;
		background: #1b222a;
		color: #e4e9ed;
		border-radius: var(--flow-radius, 0.375rem);
		min-height: var(--flow-control-height, 2.25rem);
		padding: 0.4375rem 0.75rem;
		font: inherit;
		font-size: var(--flow-control-font, 0.875rem);
		font-weight: 500;
		line-height: 1.25rem;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.library {
		border: 1px solid #34443c;
		padding: 0.7rem;
		border-radius: var(--flow-radius, 0.375rem);
	}
	small {
		color: #a4adb7;
		font-size: var(--flow-help-font, 0.75rem);
		line-height: 1.5;
	}
	input {
		width: 100%;
		max-width: 100%;
		font: inherit;
		font-size: var(--flow-help-font, 0.75rem);
		color: #a4adb7;
	}
	p[role='alert'] {
		color: #ffb4be;
	}

	label {
		font-size: var(--flow-label-font, 0.8125rem);
		color: #c7ced5;
	}
	button:hover:not(:disabled) {
		border-color: #6b7a84;
		background: #222d34;
	}
	button:focus-visible,
	input:focus-visible {
		outline: 2px solid #6ee7b7;
		outline-offset: 2px;
	}

	label {
		display: grid;
		gap: 0.375rem;
		width: 100%;
	}
	input::file-selector-button {
		min-height: var(--flow-control-height, 2.25rem);
		padding: 0.4375rem 0.75rem;
		margin-right: 0.5rem;
		border: 1px solid #39414b;
		border-radius: var(--flow-radius, 0.375rem);
		background: #1b222a;
		color: #e4e9ed;
		font: inherit;
		font-size: var(--flow-control-font, 0.875rem);
		line-height: 1.25rem;
		cursor: pointer;
	}
	input:disabled {
		opacity: 0.5;
	}
</style>
