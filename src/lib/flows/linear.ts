export type LinearTransform = 'none' | 'trim' | 'uppercase' | 'lowercase';

export interface LinearFlowDraft {
	name: string;
	description: string;
	modelId: string;
	prompt: string;
	transform: LinearTransform;
}

export function defaultLinearFlowDraft(modelId = ''): LinearFlowDraft {
	return {
		name: '',
		description: '',
		modelId,
		prompt: 'Respond to {{node.input.output}}',
		transform: 'none'
	};
}

export function buildLinearFlowDefinition(draft: LinearFlowDraft) {
	const transform =
		draft.transform === 'none'
			? []
			: [
					{
						id: 'transform',
						type: 'transform' as const,
						position: { x: 480, y: 0 },
						config: { operation: draft.transform }
					}
				];
	return {
		schemaVersion: 1 as const,
		nodes: [
			{
				id: 'input',
				type: 'input' as const,
				position: { x: 0, y: 0 },
				config: { key: 'request' }
			},
			{
				id: 'model',
				type: 'model' as const,
				position: { x: 240, y: 0 },
				config: { modelId: draft.modelId, prompt: draft.prompt }
			},
			...transform,
			{
				id: 'output',
				type: 'output' as const,
				position: { x: draft.transform === 'none' ? 480 : 720, y: 0 },
				config: { format: 'text' as const }
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
	const expected = buildLinearFlowDefinition({
		name: value.name,
		description: typeof value.description === 'string' ? value.description : '',
		modelId: model.config.modelId,
		prompt: model.config.prompt,
		transform: transformType
	});
	if (!sameEdges(edges, expected.edges)) return null;
	return {
		name: value.name,
		description: typeof value.description === 'string' ? value.description : '',
		modelId: model.config.modelId,
		prompt: model.config.prompt,
		transform: transformType
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
