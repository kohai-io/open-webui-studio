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
	import FlowNodeCard from './FlowNodeCard.svelte';
	import {
		flowDefinitionToCanvas,
		type FlowCanvasEdge,
		type FlowCanvasNode
	} from '$lib/flows/canvas';
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
		onaddnode: (type: AdmittedFlowNodeType) => void;
		ondeleteedge: (edgeId: string) => void;
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
		ondeleteedge
	}: Props = $props();
	const nodeTypes = { flowNode: FlowNodeCard } satisfies NodeTypes;
	let nodes = $state.raw<FlowCanvasNode[]>([]);
	let edges = $state.raw<FlowCanvasEdge[]>([]);

	$effect(() => {
		const view = flowDefinitionToCanvas(definition, executionByNodeId, {
			nodeId: selectedNodeId,
			edgeId: selectedEdgeId
		});
		nodes = view.nodes;
		edges = view.edges;
	});
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
		<Panel position="top-left" class="node-library">
			<span>Add node</span>
			<div>
				<button type="button" onclick={() => onaddnode('input')}>Input</button>
				<button type="button" onclick={() => onaddnode('model')}>Model</button>
				<button type="button" onclick={() => onaddnode('transform')}>Transform</button>
				<button
					type="button"
					disabled={definition.nodes.some((node) => node.type === 'output')}
					onclick={() => onaddnode('output')}>Output</button
				>
			</div>
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
	:global(.node-library),
	:global(.canvas-help),
	:global(.edge-actions) {
		border: 1px solid #303944;
		border-radius: 0.75rem;
		background: rgba(11, 15, 19, 0.94);
		box-shadow: 0 0.7rem 2rem rgba(0, 0, 0, 0.3);
	}
	:global(.node-library) {
		display: grid;
		gap: 0.5rem;
		padding: 0.65rem;
	}
	:global(.node-library > span),
	:global(.canvas-help),
	:global(.edge-actions > span) {
		color: #8d98a3;
		font-size: 0.7rem;
	}
	:global(.node-library > div) {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	:global(.node-library button),
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
	:global(.node-library button:disabled) {
		opacity: 0.4;
		cursor: not-allowed;
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
</style>
