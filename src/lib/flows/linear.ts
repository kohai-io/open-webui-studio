import type { FlowDefinitionV1, FlowPositionV1 } from './types';

export type LinearTransform = 'none' | 'trim' | 'uppercase' | 'lowercase';
export type LinearNodeId = 'input' | 'model' | 'transform' | 'output';
export type LinearFlowPositions = Record<LinearNodeId, FlowPositionV1>;

export interface LinearFlowDraft {
	name: string;
	description: string;
	modelId: string;
	prompt: string;
	transform: LinearTransform;
	positions: LinearFlowPositions;
}

export function defaultLinearFlowDraft(modelId = ''): LinearFlowDraft {
	return {
		name: '',
		description: '',
		modelId,
		prompt: 'Respond to {{node.input.output}}',
		transform: 'none',
		positions: {
			input: { x: 0, y: 0 },
			model: { x: 300, y: 0 },
			transform: { x: 600, y: 0 },
			output: { x: 900, y: 0 }
		}
	};
}

export function buildLinearFlowDefinition(draft: LinearFlowDraft): FlowDefinitionV1 {
	const transform =
		draft.transform === 'none'
			? []
			: [
					{
						id: 'transform',
						type: 'transform' as const,
						position: { ...draft.positions.transform },
						config: { operation: draft.transform }
					}
				];
	return {
		schemaVersion: 1,
		nodes: [
			{
				id: 'input',
				type: 'input',
				position: { ...draft.positions.input },
				config: { key: 'request' }
			},
			{
				id: 'model',
				type: 'model',
				position: { ...draft.positions.model },
				config: { modelId: draft.modelId, prompt: draft.prompt }
			},
			...transform,
			{
				id: 'output',
				type: 'output',
				position: { ...draft.positions.output },
				config: { format: 'text' }
			}
		],
		edges:
			draft.transform === 'none'
				? [
						{ id: 'input-model', source: 'input', target: 'model' },
						{ id: 'model-output', source: 'model', target: 'output' }
					]
				: [
						{ id: 'input-model', source: 'input', target: 'model' },
						{ id: 'model-transform', source: 'model', target: 'transform' },
						{ id: 'transform-output', source: 'transform', target: 'output' }
					]
	};
}

export function linearFlowDraftFromRecord(value: unknown): LinearFlowDraft | null {
	if (!isRecord(value) || typeof value.name !== 'string' || !isRecord(value.definition))
		return null;
	if (value.definition.schemaVersion !== 1) return null;
	const nodes = value.definition.nodes;
	const edges = value.definition.edges;
	if (!Array.isArray(nodes) || !Array.isArray(edges)) return null;
	const input = nodes.find((node) => isNode(node, 'input', 'input'));
	const model = nodes.find((node) => isNode(node, 'model', 'model'));
	const output = nodes.find((node) => isNode(node, 'output', 'output'));
	const transform = nodes.find((node) => isNode(node, 'transform', 'transform'));
	if (!input || !model || !output || nodes.length !== (transform ? 4 : 3)) return null;
	if (
		!isRecord(input.config) ||
		!hasOnlyKeys(input.config, ['key']) ||
		input.config.key !== 'request' ||
		!isRecord(model.config) ||
		!hasOnlyKeys(model.config, ['modelId', 'prompt']) ||
		typeof model.config.modelId !== 'string' ||
		typeof model.config.prompt !== 'string' ||
		!isRecord(output.config) ||
		!hasOnlyKeys(output.config, ['format']) ||
		output.config.format !== 'text'
	)
		return null;
	let transformType: LinearTransform = 'none';
	if (transform) {
		if (!isRecord(transform.config)) return null;
		if (!hasOnlyKeys(transform.config, ['operation'])) return null;
		const operation = transform.config.operation;
		if (operation !== 'trim' && operation !== 'uppercase' && operation !== 'lowercase') return null;
		transformType = operation;
	}
	const positions: LinearFlowPositions = {
		input: positionOf(input),
		model: positionOf(model),
		transform: transform ? positionOf(transform) : positionBetween(model, output),
		output: positionOf(output)
	};
	const expected = buildLinearFlowDefinition({
		name: value.name,
		description: typeof value.description === 'string' ? value.description : '',
		modelId: model.config.modelId,
		prompt: model.config.prompt,
		transform: transformType,
		positions
	});
	if (!sameEdges(edges, expected.edges)) return null;
	return {
		name: value.name,
		description: typeof value.description === 'string' ? value.description : '',
		modelId: model.config.modelId,
		prompt: model.config.prompt,
		transform: transformType,
		positions
	};
}

export function updateLinearNodePosition(
	draft: LinearFlowDraft,
	nodeId: LinearNodeId,
	position: FlowPositionV1
): LinearFlowDraft {
	return {
		...draft,
		positions: {
			...draft.positions,
			[nodeId]: { ...position }
		}
	};
}

function positionOf(node: Record<string, unknown>): FlowPositionV1 {
	const position = node.position;
	if (
		!isRecord(position) ||
		typeof position.x !== 'number' ||
		!Number.isFinite(position.x) ||
		typeof position.y !== 'number' ||
		!Number.isFinite(position.y)
	)
		return { x: 0, y: 0 };
	return { x: position.x, y: position.y };
}

function positionBetween(
	left: Record<string, unknown>,
	right: Record<string, unknown>
): FlowPositionV1 {
	const leftPosition = positionOf(left);
	const rightPosition = positionOf(right);
	return {
		x: (leftPosition.x + rightPosition.x) / 2,
		y: (leftPosition.y + rightPosition.y) / 2
	};
}

function isNode(value: unknown, id: string, type: string): value is Record<string, unknown> {
	return isRecord(value) && value.id === id && value.type === type;
}

function sameEdges(
	value: unknown[],
	expected: Array<{ id: string; source: string; target: string }>
) {
	if (value.length !== expected.length) return false;
	return expected.every((edge) =>
		value.some(
			(candidate) =>
				isRecord(candidate) &&
				candidate.id === edge.id &&
				candidate.source === edge.source &&
				candidate.target === edge.target
		)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
	return Object.keys(value).every((key) => allowed.includes(key));
}
