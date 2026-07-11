<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		Controls,
		MiniMap,
		SvelteFlow,
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
	import type { FlowDefinitionV1, FlowPositionV1 } from '$lib/flows/types';

	interface Props {
		definition: FlowDefinitionV1;
		executionByNodeId: ReadonlyMap<string, FlowExecutionNodeView>;
		onselect: (nodeId: string) => void;
		onpositionchange: (nodeId: string, position: FlowPositionV1) => void;
	}

	let { definition, executionByNodeId, onselect, onpositionchange }: Props = $props();
	const nodeTypes = { flowNode: FlowNodeCard } satisfies NodeTypes;
	let nodes = $state.raw<FlowCanvasNode[]>([]);
	let edges = $state.raw<FlowCanvasEdge[]>([]);

	$effect(() => {
		const view = flowDefinitionToCanvas(definition, executionByNodeId);
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
		nodesConnectable={false}
		elementsSelectable={true}
		deleteKey={null}
		multiSelectionKey={null}
		onnodeclick={({ node }) => onselect(node.id)}
		onnodedragstop={({ targetNode }) => {
			if (targetNode) onpositionchange(targetNode.id, targetNode.position);
		}}
		colorMode="dark"
		aria-label="Flow canvas"
	>
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
		height: 31rem;
		min-height: 24rem;
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
</style>
