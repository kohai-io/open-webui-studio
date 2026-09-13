<script lang="ts">
	import { onMount } from 'svelte';
	let { onsave, disabled = false }: { onsave: (file: File) => Promise<void>; disabled?: boolean } =
		$props();
	let canvas: HTMLCanvasElement;
	let colour = $state('#111111');
	let width = $state(8);
	let drawing = false;
	let history: ImageData[] = [];
	let canUndo = $state(false);
	let dirty = $state(false);
	function ctx() {
		return canvas.getContext('2d')!;
	}
	function clear() {
		ctx().fillStyle = '#ffffff';
		ctx().fillRect(0, 0, 1024, 1024);
		dirty = true;
	}
	onMount(() => {
		clear();
		dirty = false;
	});
	function checkpoint() {
		history.push(ctx().getImageData(0, 0, 1024, 1024));
		if (history.length > 12) history.shift();
		canUndo = true;
	}
	function point(event: PointerEvent) {
		const r = canvas.getBoundingClientRect();
		return {
			x: ((event.clientX - r.left) * 1024) / r.width,
			y: ((event.clientY - r.top) * 1024) / r.height
		};
	}
	function start(event: PointerEvent) {
		if (disabled || event.button !== 0) return;
		checkpoint();
		drawing = true;
		canvas.setPointerCapture(event.pointerId);
		const p = point(event);
		ctx().strokeStyle = colour;
		ctx().lineWidth = width;
		ctx().lineCap = 'round';
		ctx().lineJoin = 'round';
		ctx().beginPath();
		ctx().moveTo(p.x, p.y);
		ctx().lineTo(p.x + 0.01, p.y);
		ctx().stroke();
		dirty = true;
	}
	function move(event: PointerEvent) {
		if (!drawing) return;
		const p = point(event);
		ctx().lineTo(p.x, p.y);
		ctx().stroke();
	}
	function undo() {
		const previous = history.pop();
		if (previous) ctx().putImageData(previous, 0, 0);
		canUndo = history.length > 0;
		dirty = true;
	}
	async function save() {
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		if (blob) {
			try {
				await onsave(new File([blob], 'sketch.png', { type: 'image/png' }));
				dirty = false;
			} catch {
				/* The parent presents the upload error. */
			}
		}
	}
</script>

<div class="sketch">
	<div class="tools">
		<label
			>Colour <input aria-label="Brush colour" type="color" bind:value={colour} {disabled} /></label
		><label
			>Brush <input
				aria-label="Brush size"
				type="range"
				min="2"
				max="48"
				bind:value={width}
				{disabled}
			/></label
		><button type="button" disabled={disabled || !canUndo} onclick={undo}>Undo stroke</button
		><button
			type="button"
			{disabled}
			onclick={() => {
				checkpoint();
				clear();
			}}>Clear sketch</button
		>
	</div>
	<canvas
		bind:this={canvas}
		width="1024"
		height="1024"
		aria-label="Sketch drawing area"
		onpointerdown={start}
		onpointermove={move}
		onpointerup={() => (drawing = false)}
		onpointercancel={() => (drawing = false)}
		onlostpointercapture={() => (drawing = false)}
	></canvas>
	<button type="button" disabled={disabled || !dirty} onclick={save}>Use sketch as reference</button
	>
	<small
		>Draw, then use the sketch to save it as an image reference. The drawing area is temporary;
		saved references remain in run history.</small
	>
</div>

<style>
	.sketch {
		display: grid;
		gap: 0.7rem;
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		align-items: center;
	}
	canvas {
		width: min(100%, 32rem);
		height: auto;
		touch-action: none;
		border: 1px solid #44515b;
		border-radius: var(--flow-radius, 0.375rem);
		background: white;
	}
	label {
		display: flex;
		align-items: center;
		gap: 0.4rem;
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
	small {
		color: #a4adb7;
		font-size: var(--flow-help-font, 0.75rem);
		line-height: 1.5;
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
</style>
