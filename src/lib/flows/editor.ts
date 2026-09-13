import { imageConnectionError } from './types';
import type { FlowDefinitionV1, FlowEdgeV1, FlowNodeV1, FlowPositionV1 } from './types';

export type AdmittedFlowNodeType = FlowNodeV1['type'];

export interface FlowConnection {
	source: string | null;
	target: string | null;
}

export interface AddFlowNodeResult {
	definition: FlowDefinitionV1;
	nodeId: string;
}

export interface AddFlowNodeAfterResult extends AddFlowNodeResult {
	error: string | null;
	insertedBeforeNodeId: string | null;
}

export function cloneFlowDefinition(definition: FlowDefinitionV1): FlowDefinitionV1 {
	return structuredClone(definition);
}

export function addFlowNode(
	definition: FlowDefinitionV1,
	type: AdmittedFlowNodeType,
	defaultModelId = ''
): AddFlowNodeResult | null {
	if (definition.nodes.length >= 50) return null;
	if (type === 'output' && definition.nodes.some((node) => node.type === 'output')) return null;
	const id = nextNodeId(definition, type);
	const position = nextNodePosition(definition);
	const node = defaultNode(definition, id, type, position, defaultModelId);
	return {
		definition: { ...definition, nodes: [...definition.nodes, node] },
		nodeId: id
	};
}

export function addFlowNodeAfter(
	definition: FlowDefinitionV1,
	sourceNodeId: string,
	type: Exclude<AdmittedFlowNodeType, 'input'>,
	defaultModelId = ''
): AddFlowNodeAfterResult | null {
	const added = addFlowNode(definition, type, defaultModelId);
	if (!added) return null;
	const outgoing = definition.edges.filter((edge) => edge.source === sourceNodeId);
	const replacedEdge = type !== 'output' && outgoing.length === 1 ? outgoing[0] : null;
	const base = replacedEdge
		? {
				...added.definition,
				edges: added.definition.edges.filter((edge) => edge.id !== replacedEdge.id)
			}
		: added.definition;
	const connected = connectFlowNodes(base, {
		source: sourceNodeId,
		target: added.nodeId
	});
	if (connected.error)
		return {
			definition,
			nodeId: added.nodeId,
			error: connected.error,
			insertedBeforeNodeId: null
		};
	if (!replacedEdge)
		return {
			definition: connected.definition,
			nodeId: added.nodeId,
			error: null,
			insertedBeforeNodeId: null
		};
	const reconnected = connectFlowNodes(connected.definition, {
		source: added.nodeId,
		target: replacedEdge.target
	});
	return {
		definition: reconnected.error ? definition : reconnected.definition,
		nodeId: added.nodeId,
		error: reconnected.error,
		insertedBeforeNodeId: reconnected.error ? null : replacedEdge.target
	};
}

export function replaceFlowNode(
	definition: FlowDefinitionV1,
	replacement: FlowNodeV1
): FlowDefinitionV1 {
	return {
		...definition,
		nodes: definition.nodes.map((node) => (node.id === replacement.id ? replacement : node))
	};
}

export function moveFlowNode(
	definition: FlowDefinitionV1,
	nodeId: string,
	position: FlowPositionV1
): FlowDefinitionV1 {
	return {
		...definition,
		nodes: definition.nodes.map((node) =>
			node.id === nodeId ? { ...node, position: { ...position } } : node
		)
	};
}

export function removeFlowNode(definition: FlowDefinitionV1, nodeId: string): FlowDefinitionV1 {
	return {
		...definition,
		nodes: definition.nodes.filter((node) => node.id !== nodeId),
		edges: definition.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId)
	};
}

export function connectFlowNodes(
	definition: FlowDefinitionV1,
	connection: FlowConnection
): { definition: FlowDefinitionV1; error: string | null } {
	const error = flowConnectionError(definition, connection);
	if (error || !connection.source || !connection.target) return { definition, error };
	const edge: FlowEdgeV1 = {
		id: `edge-${connection.source}-${connection.target}`,
		source: connection.source,
		target: connection.target
	};
	return {
		definition: { ...definition, edges: [...definition.edges, edge] },
		error: null
	};
}

export function removeFlowEdge(definition: FlowDefinitionV1, edgeId: string): FlowDefinitionV1 {
	return { ...definition, edges: definition.edges.filter((edge) => edge.id !== edgeId) };
}

export function flowConnectionError(
	definition: FlowDefinitionV1,
	connection: FlowConnection
): string | null {
	if (!connection.source || !connection.target) return 'Choose both ends of the connection.';
	const source = definition.nodes.find((node) => node.id === connection.source);
	const target = definition.nodes.find((node) => node.id === connection.target);
	if (!source || !target) return 'That node is no longer available.';
	const mediaError = imageConnectionError(source, target);
	if (mediaError) return mediaError;
	if (source.id === target.id) return 'A node cannot connect to itself.';
	if (source.type === 'output') return 'Output nodes cannot start a connection.';
	if (target.type === 'input') return 'Input nodes cannot receive a connection.';
	if (definition.edges.some((edge) => edge.source === source.id && edge.target === target.id))
		return 'Those nodes are already connected.';
	const incoming = definition.edges.filter((edge) => edge.target === target.id).length;
	if (target.type === 'output' && incoming >= 1)
		return 'Output nodes accept exactly one incoming connection.';
	if (target.type === 'transform' && target.config.operation !== 'template' && incoming >= 1)
		return 'This Transform accepts one incoming connection.';
	if (definition.edges.length >= 100) return 'This Flow has reached the connection limit.';
	if (hasPath(definition, target.id, source.id)) return 'That connection would create a cycle.';
	return null;
}

export function flowEditorIssues(definition: FlowDefinitionV1): string[] {
	const issues: string[] = [];
	const inputs = definition.nodes.filter((node) => node.type === 'input');
	const outputs = definition.nodes.filter((node) => node.type === 'output');
	if (inputs.length === 0) issues.push('Add at least one Input node.');
	if (outputs.length !== 1) issues.push('Add exactly one Output node.');
	const inputKeys = new Set<string>();
	for (const input of inputs) {
		if (inputKeys.has(input.config.key)) issues.push('Input keys must be unique.');
		inputKeys.add(input.config.key);
	}
	for (const node of definition.nodes) {
		const incoming = definition.edges.filter((edge) => edge.target === node.id).length;
		const outgoing = definition.edges.filter((edge) => edge.source === node.id).length;
		if (node.type === 'input' && incoming > 0)
			issues.push(`${node.id} cannot receive a connection.`);
		if (node.type !== 'input' && incoming === 0) issues.push(`Connect an input into ${node.id}.`);
		if (node.type === 'output' && outgoing > 0)
			issues.push(`${node.id} cannot start a connection.`);
		if (node.type !== 'output' && outgoing === 0)
			issues.push(`Connect ${node.id} to a later node.`);
		if (
			incoming > 1 &&
			(node.type === 'output' ||
				(node.type === 'transform' && node.config.operation !== 'template'))
		)
			issues.push(`${node.id} accepts one incoming connection.`);
	}
	for (const edge of definition.edges) {
		const source = definition.nodes.find((n) => n.id === edge.source),
			target = definition.nodes.find((n) => n.id === edge.target);
		if (source && target) {
			const error = imageConnectionError(source, target);
			if (error) issues.push(error);
		}
	}
	if (containsCycle(definition)) issues.push('Remove the cycle before saving.');
	return [...new Set(issues)];
}

function defaultNode(
	definition: FlowDefinitionV1,
	id: string,
	type: AdmittedFlowNodeType,
	position: FlowPositionV1,
	defaultModelId: string
): FlowNodeV1 {
	if (type === 'input') {
		const usedKeys = new Set(
			definition.nodes.filter((node) => node.type === 'input').map((node) => node.config.key)
		);
		let suffix = 1;
		let key = 'request';
		while (usedKeys.has(key)) key = `input${++suffix}`;
		return { id, type, position, config: { key } };
	}
	if (type === 'image') {
		const input = definition.nodes.find(
			(node) => node.type === 'input' && node.config.kind !== 'images'
		);
		return {
			id,
			type,
			position,
			config: {
				operation: 'generate',
				prompt: input ? `{{node.${input.id}.output}}` : 'Describe the image to create.'
			}
		};
	}
	if (type === 'model') {
		const input = definition.nodes.find((node) => node.type === 'input');
		return {
			id,
			type,
			position,
			config: {
				modelId: defaultModelId,
				prompt: input ? `Respond to {{node.${input.id}.output}}` : 'Respond to the provided input.'
			}
		};
	}
	if (type === 'transform') return { id, type, position, config: { operation: 'trim' } };
	return { id, type, position, config: { format: 'text' } };
}

function nextNodeId(definition: FlowDefinitionV1, type: AdmittedFlowNodeType): string {
	const ids = new Set(definition.nodes.map((node) => node.id));
	if (!ids.has(type)) return type;
	let suffix = 2;
	while (ids.has(`${type}-${suffix}`)) suffix++;
	return `${type}-${suffix}`;
}

function nextNodePosition(definition: FlowDefinitionV1): FlowPositionV1 {
	if (definition.nodes.length === 0) return { x: 0, y: 0 };
	return {
		x: Math.max(...definition.nodes.map((node) => node.position.x)) + 300,
		y: Math.min(...definition.nodes.map((node) => node.position.y))
	};
}

function hasPath(definition: FlowDefinitionV1, start: string, target: string): boolean {
	const adjacency = new Map(definition.nodes.map((node) => [node.id, [] as string[]]));
	for (const edge of definition.edges) adjacency.get(edge.source)?.push(edge.target);
	const queue = [start];
	const seen = new Set<string>();
	for (let cursor = 0; cursor < queue.length; cursor++) {
		const current = queue[cursor];
		if (current === target) return true;
		if (seen.has(current)) continue;
		seen.add(current);
		queue.push(...(adjacency.get(current) ?? []));
	}
	return false;
}

function containsCycle(definition: FlowDefinitionV1): boolean {
	const indegree = new Map(definition.nodes.map((node) => [node.id, 0]));
	const adjacency = new Map(definition.nodes.map((node) => [node.id, [] as string[]]));
	for (const edge of definition.edges) {
		if (!indegree.has(edge.source) || !indegree.has(edge.target)) continue;
		indegree.set(edge.target, indegree.get(edge.target)! + 1);
		adjacency.get(edge.source)!.push(edge.target);
	}
	const queue = definition.nodes
		.filter((node) => indegree.get(node.id) === 0)
		.map((node) => node.id);
	let visited = 0;
	for (let cursor = 0; cursor < queue.length; cursor++) {
		visited++;
		for (const target of adjacency.get(queue[cursor]) ?? []) {
			const next = indegree.get(target)! - 1;
			indegree.set(target, next);
			if (next === 0) queue.push(target);
		}
	}
	return visited !== definition.nodes.length;
}
