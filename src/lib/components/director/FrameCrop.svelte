<script lang="ts">
	import { untrack } from 'svelte';
	import { base } from '$app/paths';
	import type { FrameCrop } from '$lib/director/types';
	import { cropGeometry } from '$lib/director/crop';
	let {
		sourceFileId,
		ratio,
		previous,
		disabled = false,
		onapply
	}: {
		sourceFileId: string;
		ratio: FrameCrop['ratio'];
		previous?: FrameCrop;
		disabled?: boolean;
		onapply: (blob: Blob, crop: FrameCrop) => Promise<boolean>;
	} = $props();
	let open = $state(false);
	let x = $state(untrack(() => previous?.x ?? 50));
	let y = $state(untrack(() => previous?.y ?? 50));
	let zoom = $state(untrack(() => previous?.zoom ?? 1));
	let source = $state.raw<HTMLImageElement>();
	let canvas = $state<HTMLCanvasElement>();
	let error = $state('');
	let preparing = $state(false);
	const crop = $derived({ sourceFileId, ratio, x, y, zoom });
	const rectangle = $derived(
		source ? cropGeometry(source.naturalWidth, source.naturalHeight, crop) : null
	);
	$effect(() => {
		if (!canvas || !source || !rectangle) return;
		canvas.width = rectangle.width;
		canvas.height = rectangle.height;
		canvas
			.getContext('2d')
			?.drawImage(
				source,
				rectangle.sx,
				rectangle.sy,
				rectangle.sw,
				rectangle.sh,
				0,
				0,
				rectangle.width,
				rectangle.height
			);
	});
	async function apply() {
		if (!canvas || !rectangle || preparing || disabled) return;
		preparing = true;
		error = '';
		const selectedCrop = { ...crop };
		const applyCrop = onapply;
		try {
			const blob = await new Promise<Blob>((resolve, reject) =>
				canvas!.toBlob(
					(value) => (value ? resolve(value) : reject(new Error('Could not prepare this crop.'))),
					'image/png'
				)
			);
			if (blob.size > 10 * 1024 * 1024)
				throw new Error('The cropped image exceeds the 10 MB upload limit.');
			if (await applyCrop(blob, selectedCrop)) open = false;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Could not prepare this crop.';
		} finally {
			preparing = false;
		}
	}
</script>

<details bind:open>
	<summary>Prepare video crop</summary>
	{#if open}<div class="stack crop-editor">
			<p>
				Choose the {ratio} frame sent to video generation. The original image is preserved. Preparing
				a crop uses no generation credits.
			</p>
			<div class="crop-layout">
				<div class="stack">
					<span class="muted">Original image</span>
					<img
						class="crop-source"
						src={`${base}/media/${encodeURIComponent(sourceFileId)}/content`}
						alt="Original first frame"
						onload={(event) => {
							source = event.currentTarget as HTMLImageElement;
							error = '';
						}}
						onerror={() => {
							source = undefined;
							error = 'The original frame could not be loaded. Try reopening the crop tool.';
						}}
					/>
				</div>
				<div class="stack">
					<span class="muted">Video crop · {ratio}</span>
					<canvas bind:this={canvas} class="crop-preview" aria-label="Video crop preview"></canvas>
					{#if rectangle}<small>{rectangle.width} × {rectangle.height} pixels</small>{/if}
				</div>
			</div>
			<label
				>Horizontal position<input
					type="range"
					min="0"
					max="100"
					step="1"
					bind:value={x}
					disabled={disabled || preparing}
				/></label
			>
			<label
				>Vertical position<input
					type="range"
					min="0"
					max="100"
					step="1"
					bind:value={y}
					disabled={disabled || preparing}
				/></label
			>
			<label
				>Zoom<input
					type="range"
					min="1"
					max="3"
					step="0.05"
					bind:value={zoom}
					disabled={disabled || preparing}
				/></label
			>
			{#if error}<p role="alert">{error}</p>{/if}
			<div class="row">
				<button type="button" disabled={disabled || preparing || !rectangle} onclick={apply}>
					{preparing ? 'Saving crop…' : 'Use this crop'}</button
				>
				<button
					type="button"
					disabled={disabled || preparing}
					onclick={() => {
						x = 50;
						y = 50;
						zoom = 1;
					}}>Reset crop</button
				>
			</div>
		</div>{/if}
</details>
