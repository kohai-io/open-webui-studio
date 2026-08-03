import type { FlowDefinitionV1 } from './types';

const COLUMN_GAP = 300;
const ROW_GAP = 180;

export function autoLayoutFlowDefinition(definition: FlowDefinitionV1): FlowDefinitionV1 {
	if (definition.nodes.length === 0) return structuredClone(definition);

	const order = new Map(definition.nodes.map((node, index) => [node.id, index]));
	const indegree = new Map(definition.nodes.map((node) => [node.id, 0]));
	const adjacency = new Map(definition.nodes.map((node) => [node.id, [] as string[]]));
	for (const edge of definition.edges) {
		if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
		indegree.set(edge.target, indegree.get(edge.target)! + 1);
		adjacency.get(edge.source)!.push(edge.target);
	}
	for (const targets of adjacency.values())
		targets.sort((left, right) => order.get(left)! - order.get(right)!);

	const queue = definition.nodes
		.filter((node) => indegree.get(node.id) === 0)
		.map((node) => node.id);
	const layers = new Map(definition.nodes.map((node) => [node.id, 0]));
	const visited = new Set<string>();
	for (let cursor = 0; cursor < queue.length; cursor++) {
		const source = queue[cursor];
		visited.add(source);
		for (const target of adjacency.get(source) ?? []) {
			layers.set(target, Math.max(layers.get(target) ?? 0, (layers.get(source) ?? 0) + 1));
			const nextIndegree = indegree.get(target)! - 1;
			indegree.set(target, nextIndegree);
			if (nextIndegree === 0) queue.push(target);
		}
	}

	const highestLayer = Math.max(0, ...layers.values());
	for (const node of definition.nodes)
		if (!visited.has(node.id)) layers.set(node.id, highestLayer + 1);

	const nodesByLayer = new Map<number, typeof definition.nodes>();
	for (const node of definition.nodes) {
		const layer = layers.get(node.id) ?? 0;
		const nodes = nodesByLayer.get(layer) ?? [];
		nodes.push(node);
		nodesByLayer.set(layer, nodes);
	}

	const positions = new Map<string, { x: number; y: number }>();
	for (const [layer, nodes] of nodesByLayer) {
		nodes.sort(
			(left, right) =>
				left.position.y - right.position.y || order.get(left.id)! - order.get(right.id)!
		);
		for (const [row, node] of nodes.entries()) {
			positions.set(node.id, {
				x: layer * COLUMN_GAP,
				y: (row - (nodes.length - 1) / 2) * ROW_GAP
			});
		}
	}

	return {
		...structuredClone(definition),
		nodes: definition.nodes.map((node) => ({
			...structuredClone(node),
			position: positions.get(node.id) ?? { ...node.position }
		}))
	};
}
