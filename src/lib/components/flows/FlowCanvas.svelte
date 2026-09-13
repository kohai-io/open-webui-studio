<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		Controls,
		MiniMap,
		Panel,
		SvelteFlow,
		type Connection,
		type FitViewOptions,
		type NodeTypes
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { tick } from 'svelte';
	import FlowNodeCard from './FlowNodeCard.svelte';
	import {
		flowDefinitionToCanvas,
		type FlowCanvasEdge,
		type FlowCanvasNode
	} from '$lib/flows/canvas';
	import { searchFlowNodeCatalogue, type FlowNodeCatalogueItem } from '$lib/flows/catalogue';
	import type { FlowExecutionNodeView } from '$lib/flows/execution-state';
	import { flowConnectionError, type AdmittedFlowNodeType } from '$lib/flows/editor';
	import type { FlowDefinitionV1, FlowPositionV1 } from '$lib/flows/types';

	interface Props {
		onpickeropen?: () => void;
		fullscreen?: boolean;
		locked?: boolean;
		leftInset?: number;
		rightInset?: number;
		definition: FlowDefinitionV1;
		executionByNodeId: ReadonlyMap<string, FlowExecutionNodeView>;
		selectedNodeId: string | null;
		selectedEdgeId: string | null;
		onselect: (nodeId: string) => void;
		onselectedge: (edgeId: string) => void;
		onclearselection: () => void;
		onpositionchange: (nodeId: string, position: FlowPositionV1) => void;
		onconnectnodes: (connection: Connection) => void;
		onaddnode: (type: AdmittedFlowNodeType, sourceNodeId: string | null) => void;
		ondeleteedge: (edgeId: string) => void;
		onautolayout: () => void;
		onundo: () => void;
		onredo: () => void;
		canUndo: boolean;
		canRedo: boolean;
	}

	let {
		onpickeropen,
		fullscreen = false,
		locked = false,
		leftInset = 32,
		rightInset = 32,
		definition,
		executionByNodeId,
		selectedNodeId,
		selectedEdgeId,
		onselect,
		onselectedge,
		onclearselection,
		onpositionchange,
		onconnectnodes,
		onaddnode,
		ondeleteedge,
		onautolayout,
		onundo,
		onredo,
		canUndo,
		canRedo
	}: Props = $props();
	let fitOptions: FitViewOptions = $derived({
		padding: { top: '160px', bottom: '100px', left: `${leftInset}px`, right: `${rightInset}px` },
		minZoom: 0.15,
		maxZoom: 1
	});
	const nodeTypes = { flowNode: FlowNodeCard } satisfies NodeTypes;
	let nodes = $state.raw<FlowCanvasNode[]>([]);
	let edges = $state.raw<FlowCanvasEdge[]>([]);
	let pickerOpen = $state(false);
	let catalogueQuery = $state('');
	let searchInput = $state<HTMLInputElement | null>(null);
	let catalogueItems = $derived(searchFlowNodeCatalogue(catalogueQuery));
	let guideFromNode = $derived(
		selectedNodeId
			? (definition.nodes.find((node) => node.id === selectedNodeId && node.type !== 'output') ??
					null)
			: null
	);
	let guideOutgoing = $derived(
		guideFromNode ? definition.edges.filter((edge) => edge.source === guideFromNode?.id) : []
	);

	$effect(() => {
		const view = flowDefinitionToCanvas(definition, executionByNodeId, {
			nodeId: selectedNodeId,
			edgeId: selectedEdgeId
		});
		nodes = view.nodes;
		edges = view.edges;
	});

	$effect(() => {
		if (locked) pickerOpen = false;
	});
	async function openPicker() {
		if (locked) return;
		catalogueQuery = '';
		pickerOpen = true;
		onpickeropen?.();
		await tick();
		searchInput?.focus();
	}

	function closePicker() {
		pickerOpen = false;
		catalogueQuery = '';
		document.querySelector<HTMLButtonElement>('.add-node')?.focus();
	}

	function chooseNode(item: FlowNodeCatalogueItem) {
		if (locked) return;
		if (item.type === 'output' && definition.nodes.some((node) => node.type === 'output')) return;
		const sourceNodeId = item.type === 'input' ? null : (guideFromNode?.id ?? null);
		onaddnode(item.type, sourceNodeId);
		closePicker();
	}

	function pickerKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			closePicker();
			document.querySelector<HTMLButtonElement>('.add-node')?.focus();
		}
	}

	function guidedActionLabel(item: FlowNodeCatalogueItem): string {
		if (!guideFromNode || item.type === 'input') return 'Add unconnected';
		if (item.type !== 'output' && guideOutgoing.length === 1)
			return `Insert before ${guideOutgoing[0].target}`;
		return `Connect after ${guideFromNode.id}`;
	}
</script>

<div class="canvas" class:fullscreen data-testid="flow-canvas">
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		fitView
		minZoom={0.15}
		fitViewOptions={fitOptions}
		nodesConnectable={!locked}
		nodesDraggable={!locked}
		elementsSelectable={true}
		deleteKey={null}
		multiSelectionKey={null}
		onnodeclick={({ node }) => onselect(node.id)}
		onedgeclick={({ edge }) => onselectedge(edge.id)}
		onpaneclick={onclearselection}
		onconnect={(connection) => {
			if (!locked) onconnectnodes(connection);
		}}
		isValidConnection={(connection) => flowConnectionError(definition, connection) === null}
		onnodedragstop={({ targetNode }) => {
			if (targetNode && !locked) onpositionchange(targetNode.id, targetNode.position);
		}}
		colorMode="dark"
		aria-label="Flow canvas"
	>
		<Panel position="bottom-center" class="editor-tools">
			<div class="tool-row">
				<button
					class="add-node"
					type="button"
					disabled={locked}
					aria-expanded={pickerOpen}
					aria-controls="flow-node-picker"
					onclick={() => (pickerOpen ? closePicker() : openPicker())}
				>
					<span aria-hidden="true">+</span>
					Add node
				</button>
				<button
					type="button"
					disabled={locked || !canUndo}
					title="Undo canvas change (Ctrl/Cmd+Z)"
					aria-label="Undo canvas change"
					onclick={onundo}>Undo</button
				>
				<button
					type="button"
					disabled={locked || !canRedo}
					title="Redo canvas change (Ctrl/Cmd+Shift+Z)"
					aria-label="Redo canvas change"
					onclick={onredo}>Redo</button
				>
				<button
					type="button"
					disabled={locked || definition.nodes.length < 2}
					title="Arrange nodes by dependency"
					onclick={onautolayout}>Auto layout</button
				>
			</div>
			{#if pickerOpen}
				<div
					id="flow-node-picker"
					class="node-picker"
					role="dialog"
					tabindex="-1"
					aria-labelledby="node-picker-title"
					onkeydown={pickerKeydown}
				>
					<div class="picker-heading">
						<div>
							<strong id="node-picker-title"
								>{guideFromNode ? `Add after ${guideFromNode.id}` : 'Add a node'}</strong
							>
							<span
								>{guideFromNode
									? 'Compatible nodes connect automatically.'
									: 'Choose a building block for this Flow.'}</span
							>
						</div>
						<button type="button" aria-label="Close node picker" onclick={closePicker}>×</button>
					</div>
					<label class="catalogue-search">
						<span>Search node catalogue</span>
						<input
							bind:this={searchInput}
							bind:value={catalogueQuery}
							type="search"
							placeholder="Search AI, prompt, JSON…"
						/>
					</label>
					<div class="catalogue-results" aria-live="polite">
						{#each catalogueItems as item (item.type)}
							{@const unavailable =
								item.type === 'output' && definition.nodes.some((node) => node.type === 'output')}
							<button
								class="catalogue-item"
								type="button"
								disabled={locked || unavailable}
								onclick={() => chooseNode(item)}
							>
								<span class="item-heading">
									<strong>{item.name}</strong>
									<em>{item.category}</em>
								</span>
								<span>{unavailable ? 'This Flow already has an Output.' : item.description}</span>
								<small>{guidedActionLabel(item)}</small>
							</button>
						{:else}
							<p class="no-results">No nodes match “{catalogueQuery}”.</p>
						{/each}
					</div>
				</div>
			{/if}
		</Panel>
		{#if selectedEdgeId}
			<Panel position="bottom-center" class="edge-actions">
				<span>Connection selected</span>
				<button type="button" disabled={locked} onclick={() => ondeleteedge(selectedEdgeId)}
					>Delete connection</button
				>
			</Panel>
		{/if}
		<Controls showLock={false} fitViewOptions={fitOptions} />
		<Background variant={BackgroundVariant.Dots} patternColor="#34413c" gap={22} size={1.2} />
		<MiniMap
			bgColor="#0b0f13"
			nodeColor="#4d8b73"
			nodeStrokeColor="#6ee7b7"
			maskColor="rgba(5, 8, 10, 0.7)"
			pannable
			zoomable
		/>
	</SvelteFlow>
</div>
{#if !fullscreen}<p class="canvas-help">
		Select a node to edit its settings. Drag between ports to connect nodes.
	</p>{/if}

<style>
	.canvas {
		height: clamp(24rem, 55vh, 38rem);
		min-height: 24rem;
		overflow: hidden;
		border: 1px solid #252d35;
		border-radius: 0.75rem;
		background: #090c0f;
	}
	:global(.svelte-flow__node-flowNode.selected article) {
		outline: 2px solid #6ee7b7;
		outline-offset: 3px;
	}
	:global(.svelte-flow__edge-path) {
		stroke: #4d8b73;
		stroke-width: 2;
	}
	:global(.svelte-flow__controls),
	:global(.svelte-flow__minimap) {
		border: 1px solid #303944;
		background: #11171c;
	}
	:global(.svelte-flow__controls-button) {
		border-bottom-color: #303944;
		background: #11171c;
		fill: #d7dde2;
	}
	:global(.editor-tools),
	:global(.edge-actions) {
		border: 1px solid #303944;
		border-radius: 0.75rem;
		background: rgba(11, 15, 19, 0.94);
		box-shadow: 0 0.7rem 2rem rgba(0, 0, 0, 0.3);
	}
	:global(.editor-tools) {
		display: grid;
		gap: 0.5rem;
		padding: 0.5rem;
	}
	:global(.tool-row) {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	:global(.tool-row button),
	:global(.edge-actions button) {
		border: 1px solid #3b4a44;
		border-radius: var(--flow-radius, 0.375rem);
		background: #1b222a;
		color: #d5e2db;
		min-height: 2rem;
		padding: 0.3125rem 0.625rem;
		line-height: 1.25rem;
		font: inherit;
		font-size: var(--flow-label-font, 0.8125rem);
		font-weight: 500;
		cursor: pointer;
	}
	:global(.tool-row .add-node) {
		border-color: #4d8b73;
		background: #183629;
	}
	:global(.tool-row .add-node span) {
		margin-right: 0.2rem;
		font-size: 1rem;
		line-height: 0;
	}
	:global(.tool-row button:disabled) {
		opacity: 0.42;
		cursor: not-allowed;
	}
	:global(.node-picker) {
		display: grid;
		gap: 0.75rem;
		width: min(31rem, calc(100vw - 7rem));
		max-height: min(30rem, calc(100dvh - 15rem));
		order: -1;
		overflow: hidden;
		padding-top: 0.6rem;
		border-top: 1px solid #303944;
	}
	:global(.picker-heading) {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1rem;
	}
	:global(.picker-heading > div) {
		display: grid;
		gap: 0.2rem;
	}
	:global(.picker-heading strong) {
		color: #f5f7f8;
		font-size: var(--flow-control-font, 0.875rem);
	}
	:global(.picker-heading span),
	:global(.edge-actions > span) {
		color: #8d98a3;
		font-size: var(--flow-help-font, 0.75rem);
	}
	:global(.picker-heading > button) {
		border: 0;
		background: transparent;
		color: #aeb6bf;
		font: inherit;
		font-size: 1.2rem;
		cursor: pointer;
	}
	:global(.catalogue-search) {
		display: grid;
		gap: 0.35rem;
		color: #8d98a3;
		font-size: var(--flow-help-font, 0.75rem);
	}
	:global(.catalogue-search input) {
		width: 100%;
		border: 1px solid #34413c;
		border-radius: 0.65rem;
		background: #070a0d;
		color: #f5f7f8;
		padding: 0.65rem 0.75rem;
		font: inherit;
	}
	:global(.catalogue-results) {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		overflow-y: auto;
		padding-right: 0.15rem;
	}
	:global(.catalogue-item) {
		font: inherit;
		display: grid;
		gap: 0.45rem;
		min-width: 0;
		padding: 0.75rem;
		border: 1px solid #303944;
		border-radius: 0.7rem;
		background: #0d1216;
		color: #c7ced5;
		text-align: left;
		cursor: pointer;
	}
	:global(.catalogue-item:hover:not(:disabled)),
	:global(.catalogue-item:focus-visible) {
		border-color: #4d8b73;
		background: #111d18;
	}
	:global(.catalogue-item:disabled) {
		opacity: 0.4;
		cursor: not-allowed;
	}
	:global(.item-heading) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	:global(.item-heading strong) {
		color: #f5f7f8;
		font-size: var(--flow-control-font, 0.875rem);
	}
	:global(.item-heading em) {
		color: #6ee7b7;
		font-size: 0.6875rem;
		font-style: normal;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	:global(.catalogue-item > span:not(.item-heading)) {
		color: #8d98a3;
		font-size: var(--flow-help-font, 0.75rem);
		line-height: 1.4;
	}
	:global(.catalogue-item small) {
		color: #d5e2db;
		font-size: var(--flow-help-font, 0.75rem);
	}
	:global(.no-results) {
		grid-column: 1 / -1;
		margin: 0;
		padding: 1rem;
		color: #8d98a3;
		font-size: 0.75rem;
		text-align: center;
	}
	:global(.edge-actions) {
		bottom: 4.5rem;
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.55rem 0.65rem;
	}
	:global(.edge-actions button) {
		border-color: #743b45;
		background: #2b171b;
		color: #ffc5cc;
	}
	@media (max-width: 700px) {
		:global(.svelte-flow__minimap) {
			display: none;
		}
		:global(.catalogue-results) {
			grid-template-columns: 1fr;
		}
	}

	:global(.tool-row button:hover:not(:disabled)) {
		border-color: #77968a;
	}
	:global(.tool-row button:focus-visible),
	:global(.catalogue-search input:focus-visible),
	:global(.picker-heading > button:focus-visible) {
		outline: 2px solid #6ee7b7;
		outline-offset: 2px;
	}
	@media (pointer: coarse) {
		:global(.tool-row button) {
			min-height: 2.75rem;
		}
	}

	.canvas-help {
		margin: 0.5rem 0 0;
		color: #a4adb7;
		font-size: var(--flow-help-font, 0.75rem);
		line-height: 1.5;
	}

	.canvas.fullscreen {
		height: 100%;
		min-height: 0;
		border: 0;
		border-radius: 0;
	}
	:global(.editor-tools) {
		max-width: calc(100% - 9rem);
		margin-bottom: 1rem;
	}
	:global(.node-picker) {
		width: min(31rem, 100%);
	}
	:global(.tool-row) {
		flex-wrap: nowrap;
	}
	:global(.tool-row button) {
		white-space: nowrap;
	}
	@media (max-width: 800px) {
		:global(.svelte-flow__minimap) {
			display: none;
		}
		:global(.editor-tools) {
			max-width: calc(100% - 4.5rem);
			width: max-content;
			margin-left: 1.25rem;
			margin-bottom: 0.5rem;
		}
		:global(.tool-row) {
			flex-wrap: wrap;
			gap: 0.25rem;
		}
		:global(.tool-row button) {
			padding: 0.3125rem 0.5rem;
			font-size: 0.75rem;
		}
		:global(.node-picker) {
			width: min(31rem, calc(100vw - 6rem));
			max-height: calc(100dvh - 17rem);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.svelte-flow *) {
			animation: none !important;
			transition: none !important;
		}
	}

	.canvas.fullscreen :global(.svelte-flow__background) {
		z-index: 0;
	}
	.canvas.fullscreen :global(.svelte-flow) {
		z-index: auto;
	}
	:global(.editor-tools) {
		z-index: 20;
	}
	:global(.node-picker) {
		animation: picker-reveal 160ms ease-out;
	}
	@keyframes picker-reveal {
		from {
			opacity: 0;
			transform: translateY(0.375rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.node-picker) {
			animation: none;
		}
	}
</style>
