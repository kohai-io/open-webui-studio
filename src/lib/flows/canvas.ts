import type { Edge, Node } from '@xyflow/svelte';
import type { FlowExecutionNodeView } from './execution-state';
import type { FlowDefinitionV1, FlowNodeV1 } from './types';

export interface FlowCanvasNodeData extends Record<string, unknown> {
	definition: FlowNodeV1;
	label: string;
	summary: string;
	execution: FlowExecutionNodeView | null;
}

export type FlowCanvasNode = Node<FlowCanvasNodeData, 'flowNode'>;
export type FlowCanvasEdge = Edge<Record<string, never>, 'default'>;

export interface FlowCanvasView {
	nodes: FlowCanvasNode[];
	edges: FlowCanvasEdge[];
}

export interface FlowCanvasSelection {
	nodeId: string | null;
	edgeId: string | null;
}

export function flowDefinitionToCanvas(
	definition: FlowDefinitionV1,
	executionByNodeId: ReadonlyMap<string, FlowExecutionNodeView> = new Map(),
	selection: FlowCanvasSelection = { nodeId: null, edgeId: null }
): FlowCanvasView {
	return {
		nodes: definition.nodes.map((node) => ({
			id: node.id,
			type: 'flowNode',
			position: { ...node.position },
			data: {
				definition: node,
				label: nodeLabel(node),
				summary: nodeSummary(node),
				execution: executionByNodeId.get(node.id) ?? null
			},
			ariaLabel: `${nodeLabel(node)} node`,
			focusable: true,
			selected: selection.nodeId === node.id
		})),
		edges: definition.edges.map((edge) => ({
			id: edge.id,
			type: 'default',
			source: edge.source,
			target: edge.target,
			focusable: true,
			selected: selection.edgeId === edge.id
		}))
	};
}

export function flowDefinitionWithCanvasPositions(
	definition: FlowDefinitionV1,
	nodes: readonly FlowCanvasNode[]
): FlowDefinitionV1 {
	const positionById = new Map(nodes.map((node) => [node.id, node.position]));
	return {
		...definition,
		nodes: definition.nodes.map((node) => {
			const position = positionById.get(node.id);
			return position ? { ...node, position: { ...position } } : node;
		})
	};
}

function nodeLabel(node: FlowNodeV1): string {
	switch (node.type) {
		case 'input':
			return 'Input';
		case 'image':
			return 'Image';
		case 'model':
			return 'Model';
		case 'transform':
			return 'Transform';
		case 'output':
			return 'Output';
	}
}

function nodeSummary(node: FlowNodeV1): string {
	switch (node.type) {
		case 'input':
			return node.config.key;
		case 'image':
			return node.config.operation === 'edit' ? 'Edit reference images' : 'Generate image';
		case 'model':
			return node.config.modelId || 'Choose a model';
		case 'transform':
			return node.config.operation.replaceAll('_', ' ');
		case 'output':
			return node.config.format;
	}
}
