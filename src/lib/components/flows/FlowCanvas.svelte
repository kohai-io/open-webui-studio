<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		Controls,
		MiniMap,
		Panel,
		SvelteFlow,
		type Connection,
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

	async function openPicker() {
		catalogueQuery = '';
		pickerOpen = true;
		await tick();
		searchInput?.focus();
	}

	function closePicker() {
		pickerOpen = false;
		catalogueQuery = '';
	}

	function chooseNode(item: FlowNodeCatalogueItem) {
		if (item.type === 'output' && definition.nodes.some((node) => node.type === 'output')) return;
		const sourceNodeId = item.type === 'input' ? null : (guideFromNode?.id ?? null);
		onaddnode(item.type, sourceNodeId);
		closePicker();
	}

	function pickerKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') closePicker();
	}

	function guidedActionLabel(item: FlowNodeCatalogueItem): string {
		if (!guideFromNode || item.type === 'input') return 'Add unconnected';
		if (item.type !== 'output' && guideOutgoing.length === 1)
			return `Insert before ${guideOutgoing[0].target}`;
		return `Connect after ${guideFromNode.id}`;
	}
</script>

<div class="canvas" data-testid="flow-canvas">
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		fitView
		fitViewOptions={{ padding: 0.22, minZoom: 0.45, maxZoom: 1.15 }}
		nodesConnectable={true}
		elementsSelectable={true}
		deleteKey={null}
		multiSelectionKey={null}
		onnodeclick={({ node }) => onselect(node.id)}
		onedgeclick={({ edge }) => onselectedge(edge.id)}
		onpaneclick={onclearselection}
		onconnect={(connection) => onconnectnodes(connection)}
		isValidConnection={(connection) => flowConnectionError(definition, connection) === null}
		onnodedragstop={({ targetNode }) => {
			if (targetNode) onpositionchange(targetNode.id, targetNode.position);
		}}
		colorMode="dark"
		aria-label="Flow canvas"
	>
		<Panel position="top-left" class="editor-tools">
			<div class="tool-row">
				<button class="add-node" type="button" onclick={openPicker}>
					<span aria-hidden="true">+</span>
					{guideFromNode ? `Next after ${guideFromNode.id}` : 'Add node'}
				</button>
				<button
					type="button"
					disabled={!canUndo}
					title="Undo canvas change (Ctrl/Cmd+Z)"
					aria-label="Undo canvas change"
					onclick={onundo}>Undo</button
				>
				<button
					type="button"
					disabled={!canRedo}
					title="Redo canvas change (Ctrl/Cmd+Shift+Z)"
					aria-label="Redo canvas change"
					onclick={onredo}>Redo</button
				>
				<button
					type="button"
					disabled={definition.nodes.length < 2}
					title="Arrange nodes by dependency"
					onclick={onautolayout}>Auto layout</button
				>
			</div>
			{#if pickerOpen}
				<div
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
								disabled={unavailable}
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
		<Panel position="top-right" class="canvas-help">
			Click a node to edit it. Drag between ports to connect nodes.
		</Panel>
		{#if selectedEdgeId}
			<Panel position="bottom-center" class="edge-actions">
				<span>Connection selected</span>
				<button type="button" onclick={() => ondeleteedge(selectedEdgeId)}>Delete connection</button
				>
			</Panel>
		{/if}
		<Controls showLock={false} />
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

<style>
	.canvas {
		height: clamp(36rem, 72vh, 52rem);
		min-height: 36rem;
		overflow: hidden;
		border: 1px solid #252d35;
		border-radius: 0.9rem;
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
	:global(.canvas-help),
	:global(.edge-actions) {
		border: 1px solid #303944;
		border-radius: 0.75rem;
		background: rgba(11, 15, 19, 0.94);
		box-shadow: 0 0.7rem 2rem rgba(0, 0, 0, 0.3);
	}
	:global(.editor-tools) {
		display: grid;
		gap: 0.5rem;
		padding: 0.65rem;
	}
	:global(.tool-row) {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	:global(.tool-row button),
	:global(.edge-actions button) {
		border: 1px solid #3b4a44;
		border-radius: 999px;
		background: #13231d;
		color: #bdf8dc;
		padding: 0.45rem 0.65rem;
		font: inherit;
		font-size: 0.72rem;
		font-weight: 700;
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
		max-height: min(35rem, calc(72vh - 7rem));
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
		font-size: 0.9rem;
	}
	:global(.picker-heading span),
	:global(.canvas-help),
	:global(.edge-actions > span) {
		color: #8d98a3;
		font-size: 0.7rem;
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
		font-size: 0.68rem;
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
		font-size: 0.82rem;
	}
	:global(.item-heading em) {
		color: #6ee7b7;
		font-size: 0.58rem;
		font-style: normal;
		font-weight: 800;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	:global(.catalogue-item > span:not(.item-heading)) {
		color: #8d98a3;
		font-size: 0.68rem;
		line-height: 1.4;
	}
	:global(.catalogue-item small) {
		color: #bdf8dc;
		font-size: 0.62rem;
	}
	:global(.no-results) {
		grid-column: 1 / -1;
		margin: 0;
		padding: 1rem;
		color: #8d98a3;
		font-size: 0.75rem;
		text-align: center;
	}
	:global(.canvas-help) {
		max-width: 17rem;
		padding: 0.65rem 0.8rem;
		line-height: 1.4;
	}
	:global(.edge-actions) {
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
		:global(.catalogue-results) {
			grid-template-columns: 1fr;
		}
		:global(.canvas-help) {
			display: none;
		}
	}
</style>
