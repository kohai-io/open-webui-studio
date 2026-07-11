import {
	FLOW_DEFINITION_SCHEMA_VERSION,
	type FlowDefinitionV1,
	type FlowEdgeV1,
	type FlowNodeV1,
	type FlowOutputNodeV1,
	type FlowPositionV1,
	type FlowInputNodeV1,
	type FlowModelNodeV1,
	type FlowTransformConfigV1
} from '$lib/flows/types';

export {
	FLOW_DEFINITION_SCHEMA_VERSION,
	type FlowDefinitionV1,
	type FlowEdgeV1,
	type FlowNodeV1,
	type FlowOutputNodeV1,
	type FlowPositionV1,
	type FlowInputNodeV1,
	type FlowModelNodeV1,
	type FlowTransformConfigV1,
	type FlowTransformNodeV1
} from '$lib/flows/types';

export const FLOW_MAX_NODES = 50;
export const FLOW_MAX_EDGES = 100;
export const FLOW_MAX_DEFINITION_BYTES = 256 * 1024;

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const JSON_PATH = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export interface FlowValidationIssue {
	path: string;
	code:
		| 'required'
		| 'invalid_type'
		| 'invalid_value'
		| 'invalid_format'
		| 'too_long'
		| 'too_many'
		| 'unknown_field'
		| 'duplicate'
		| 'unsupported_node'
		| 'forbidden_value'
		| 'invalid_reference'
		| 'invalid_graph';
}

export class FlowDefinitionError extends Error {
	readonly code = 'validation_failed';
	constructor(public readonly issues: FlowValidationIssue[]) {
		super('validation_failed');
		this.name = 'FlowDefinitionError';
	}
}

type JsonRecord = Record<string, unknown>;

class Validator {
	readonly issues: FlowValidationIssue[] = [];

	issue(path: string, code: FlowValidationIssue['code']) {
		this.issues.push({ path, code });
	}

	record(value: unknown, path: string): JsonRecord | null {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) {
			this.issue(path, 'invalid_type');
			return null;
		}
		return value as JsonRecord;
	}

	exact(value: JsonRecord, allowed: readonly string[], path: string) {
		for (const key of Object.keys(value))
			if (!allowed.includes(key)) this.issue(`${path}.${key}`, 'unknown_field');
	}

	string(
		value: unknown,
		path: string,
		options: {
			required?: boolean;
			min?: number;
			max: number;
			pattern?: RegExp;
			sensitive?: boolean;
		}
	): string | undefined {
		if (value === undefined) {
			if (options.required) this.issue(path, 'required');
			return undefined;
		}
		if (typeof value !== 'string') {
			this.issue(path, 'invalid_type');
			return undefined;
		}
		if (value.length < (options.min ?? 0)) this.issue(path, 'invalid_value');
		if (value.length > options.max) this.issue(path, 'too_long');
		if (options.pattern && !options.pattern.test(value)) this.issue(path, 'invalid_format');
		if (options.sensitive && containsSecretMaterial(value)) this.issue(path, 'forbidden_value');
		return value;
	}

	number(
		value: unknown,
		path: string,
		options: { required?: boolean; min: number; max: number; integer?: boolean }
	): number | undefined {
		if (value === undefined) {
			if (options.required) this.issue(path, 'required');
			return undefined;
		}
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			this.issue(path, 'invalid_type');
			return undefined;
		}
		if (value < options.min || value > options.max || (options.integer && !Number.isInteger(value)))
			this.issue(path, 'invalid_value');
		return value;
	}
}

export function validateFlowDefinition(value: unknown): FlowDefinitionV1 {
	const validator = new Validator();
	let encoded: string | undefined;
	try {
		encoded = JSON.stringify(value);
	} catch {
		throw new FlowDefinitionError([{ path: '$', code: 'invalid_type' }]);
	}
	if (encoded === undefined) throw new FlowDefinitionError([{ path: '$', code: 'invalid_type' }]);
	if (Buffer.byteLength(encoded, 'utf8') > FLOW_MAX_DEFINITION_BYTES)
		validator.issue('$', 'too_long');

	const root = validator.record(value, '$');
	if (!root) throw new FlowDefinitionError(validator.issues);
	validator.exact(root, ['schemaVersion', 'nodes', 'edges'], '$');
	if (root.schemaVersion !== FLOW_DEFINITION_SCHEMA_VERSION)
		validator.issue(
			'$.schemaVersion',
			root.schemaVersion === undefined ? 'required' : 'invalid_value'
		);

	const rawNodes = array(root.nodes, '$.nodes', validator);
	const rawEdges = array(root.edges, '$.edges', validator);
	if (rawNodes.length > FLOW_MAX_NODES) validator.issue('$.nodes', 'too_many');
	if (rawEdges.length > FLOW_MAX_EDGES) validator.issue('$.edges', 'too_many');

	const nodes = rawNodes
		.slice(0, FLOW_MAX_NODES)
		.map((node, index) => parseNode(node, `$.nodes[${index}]`, validator))
		.filter((node): node is FlowNodeV1 => node !== null);
	const edges = rawEdges
		.slice(0, FLOW_MAX_EDGES)
		.map((edge, index) => parseEdge(edge, `$.edges[${index}]`, validator))
		.filter((edge): edge is FlowEdgeV1 => edge !== null);

	validateGraph(nodes, edges, validator);
	if (validator.issues.length > 0) throw new FlowDefinitionError(validator.issues);
	return { schemaVersion: FLOW_DEFINITION_SCHEMA_VERSION, nodes, edges };
}

function array(value: unknown, path: string, validator: Validator): unknown[] {
	if (!Array.isArray(value)) {
		validator.issue(path, value === undefined ? 'required' : 'invalid_type');
		return [];
	}
	return value;
}

function parseNode(value: unknown, path: string, validator: Validator): FlowNodeV1 | null {
	const node = validator.record(value, path);
	if (!node) return null;
	validator.exact(node, ['id', 'type', 'position', 'config'], path);
	const id = validator.string(node.id, `${path}.id`, {
		required: true,
		min: 1,
		max: 64,
		pattern: IDENTIFIER
	});
	const type = validator.string(node.type, `${path}.type`, { required: true, min: 1, max: 32 });
	const position = parsePosition(node.position, `${path}.position`, validator);
	if (!id || !type || !position) return null;

	switch (type) {
		case 'input': {
			const config = parseInputConfig(node.config, `${path}.config`, validator);
			return config ? { id, type, position, config } : null;
		}
		case 'model': {
			const config = parseModelConfig(node.config, `${path}.config`, validator);
			return config ? { id, type, position, config } : null;
		}
		case 'transform': {
			const config = parseTransformConfig(node.config, `${path}.config`, validator);
			return config ? { id, type, position, config } : null;
		}
		case 'output': {
			const config = parseOutputConfig(node.config, `${path}.config`, validator);
			return config ? { id, type, position, config } : null;
		}
		default:
			validator.issue(`${path}.type`, 'unsupported_node');
			return null;
	}
}

function parsePosition(value: unknown, path: string, validator: Validator): FlowPositionV1 | null {
	const position = validator.record(value, path);
	if (!position) return null;
	validator.exact(position, ['x', 'y'], path);
	const x = validator.number(position.x, `${path}.x`, {
		required: true,
		min: -1_000_000,
		max: 1_000_000
	});
	const y = validator.number(position.y, `${path}.y`, {
		required: true,
		min: -1_000_000,
		max: 1_000_000
	});
	return x === undefined || y === undefined ? null : { x, y };
}

function parseInputConfig(
	value: unknown,
	path: string,
	validator: Validator
): FlowInputNodeV1['config'] | null {
	const config = validator.record(value, path);
	if (!config) return null;
	validator.exact(config, ['key', 'defaultValue'], path);
	const key = validator.string(config.key, `${path}.key`, {
		required: true,
		min: 1,
		max: 64,
		pattern: IDENTIFIER
	});
	const defaultValue = validator.string(config.defaultValue, `${path}.defaultValue`, {
		max: 16 * 1024,
		sensitive: true
	});
	if (!key) return null;
	return defaultValue === undefined ? { key } : { key, defaultValue };
}

function parseModelConfig(
	value: unknown,
	path: string,
	validator: Validator
): FlowModelNodeV1['config'] | null {
	const config = validator.record(value, path);
	if (!config) return null;
	validator.exact(config, ['modelId', 'prompt', 'temperature', 'maxTokens'], path);
	const modelId = validator.string(config.modelId, `${path}.modelId`, {
		required: true,
		min: 1,
		max: 256,
		sensitive: true
	});
	const prompt = validator.string(config.prompt, `${path}.prompt`, {
		required: true,
		min: 1,
		max: 32 * 1024,
		sensitive: true
	});
	const temperature = validator.number(config.temperature, `${path}.temperature`, {
		min: 0,
		max: 2
	});
	const maxTokens = validator.number(config.maxTokens, `${path}.maxTokens`, {
		min: 1,
		max: 32_768,
		integer: true
	});
	if (modelId?.includes('://')) validator.issue(`${path}.modelId`, 'forbidden_value');
	if (!modelId || !prompt) return null;
	return {
		modelId,
		prompt,
		...(temperature === undefined ? {} : { temperature }),
		...(maxTokens === undefined ? {} : { maxTokens })
	};
}

function parseTransformConfig(
	value: unknown,
	path: string,
	validator: Validator
): FlowTransformConfigV1 | null {
	const config = validator.record(value, path);
	if (!config) return null;
	const operation = validator.string(config.operation, `${path}.operation`, {
		required: true,
		min: 1,
		max: 32
	});
	if (!operation) return null;
	if (operation === 'uppercase' || operation === 'lowercase' || operation === 'trim') {
		validator.exact(config, ['operation'], path);
		return { operation };
	}
	if (operation === 'replace') {
		validator.exact(config, ['operation', 'search', 'replacement'], path);
		const search = validator.string(config.search, `${path}.search`, {
			required: true,
			min: 1,
			max: 1024,
			sensitive: true
		});
		const replacement = validator.string(config.replacement, `${path}.replacement`, {
			required: true,
			max: 4096,
			sensitive: true
		});
		return search === undefined || replacement === undefined
			? null
			: { operation, search, replacement };
	}
	if (operation === 'extract') {
		validator.exact(config, ['operation', 'path'], path);
		const propertyPath = validator.string(config.path, `${path}.path`, {
			required: true,
			min: 1,
			max: 256,
			pattern: JSON_PATH
		});
		return propertyPath ? { operation, path: propertyPath } : null;
	}
	if (operation === 'template') {
		validator.exact(config, ['operation', 'template'], path);
		const template = validator.string(config.template, `${path}.template`, {
			required: true,
			min: 1,
			max: 32 * 1024,
			sensitive: true
		});
		return template ? { operation, template } : null;
	}
	validator.exact(config, ['operation'], path);
	validator.issue(`${path}.operation`, 'invalid_value');
	return null;
}

function parseOutputConfig(
	value: unknown,
	path: string,
	validator: Validator
): FlowOutputNodeV1['config'] | null {
	const config = validator.record(value, path);
	if (!config) return null;
	validator.exact(config, ['format'], path);
	const format = validator.string(config.format, `${path}.format`, {
		required: true,
		min: 1,
		max: 16
	});
	if (format !== 'text' && format !== 'json') {
		if (format !== undefined) validator.issue(`${path}.format`, 'invalid_value');
		return null;
	}
	return { format };
}

function parseEdge(value: unknown, path: string, validator: Validator): FlowEdgeV1 | null {
	const edge = validator.record(value, path);
	if (!edge) return null;
	validator.exact(edge, ['id', 'source', 'target'], path);
	const id = validator.string(edge.id, `${path}.id`, {
		required: true,
		min: 1,
		max: 64,
		pattern: IDENTIFIER
	});
	const source = validator.string(edge.source, `${path}.source`, {
		required: true,
		min: 1,
		max: 64,
		pattern: IDENTIFIER
	});
	const target = validator.string(edge.target, `${path}.target`, {
		required: true,
		min: 1,
		max: 64,
		pattern: IDENTIFIER
	});
	return id && source && target ? { id, source, target } : null;
}

function validateGraph(nodes: FlowNodeV1[], edges: FlowEdgeV1[], validator: Validator) {
	if (nodes.length === 0) validator.issue('$.nodes', 'required');
	const nodeById = new Map<string, FlowNodeV1>();
	for (const [index, node] of nodes.entries()) {
		if (nodeById.has(node.id)) validator.issue(`$.nodes[${index}].id`, 'duplicate');
		else nodeById.set(node.id, node);
	}
	const inputs = nodes.filter((node) => node.type === 'input');
	const outputs = nodes.filter((node) => node.type === 'output');
	if (inputs.length === 0) validator.issue('$.nodes', 'invalid_graph');
	if (outputs.length !== 1) validator.issue('$.nodes', 'invalid_graph');
	const inputKeys = new Set<string>();
	for (const [index, node] of nodes.entries()) {
		if (node.type !== 'input') continue;
		if (inputKeys.has(node.config.key))
			validator.issue(`$.nodes[${index}].config.key`, 'duplicate');
		inputKeys.add(node.config.key);
	}

	const edgeIds = new Set<string>();
	const edgePairs = new Set<string>();
	const adjacency = new Map(nodes.map((node) => [node.id, [] as string[]]));
	const reverse = new Map(nodes.map((node) => [node.id, [] as string[]]));
	for (const [index, edge] of edges.entries()) {
		if (edgeIds.has(edge.id)) validator.issue(`$.edges[${index}].id`, 'duplicate');
		edgeIds.add(edge.id);
		const pair = `${edge.source}\0${edge.target}`;
		if (edgePairs.has(pair)) validator.issue(`$.edges[${index}]`, 'duplicate');
		edgePairs.add(pair);
		if (!nodeById.has(edge.source))
			validator.issue(`$.edges[${index}].source`, 'invalid_reference');
		if (!nodeById.has(edge.target))
			validator.issue(`$.edges[${index}].target`, 'invalid_reference');
		if (edge.source === edge.target) validator.issue(`$.edges[${index}]`, 'invalid_graph');
		if (nodeById.has(edge.source) && nodeById.has(edge.target) && edge.source !== edge.target) {
			adjacency.get(edge.source)!.push(edge.target);
			reverse.get(edge.target)!.push(edge.source);
		}
	}

	for (const [index, node] of nodes.entries()) {
		const incomingCount = reverse.get(node.id)!.length;
		if (node.type === 'input' && incomingCount > 0)
			validator.issue(`$.nodes[${index}]`, 'invalid_graph');
		if (node.type !== 'input' && incomingCount === 0)
			validator.issue(`$.nodes[${index}]`, 'invalid_graph');
		if (
			incomingCount > 0 &&
			(node.type === 'output' ||
				(node.type === 'transform' && node.config.operation !== 'template')) &&
			incomingCount !== 1
		)
			validator.issue(`$.nodes[${index}]`, 'invalid_graph');
		if (node.type === 'output' && adjacency.get(node.id)!.length > 0)
			validator.issue(`$.nodes[${index}]`, 'invalid_graph');
		if (node.type !== 'output' && adjacency.get(node.id)!.length === 0)
			validator.issue(`$.nodes[${index}]`, 'invalid_graph');
	}

	const reachable = walk(
		inputs.map((node) => node.id),
		adjacency
	);
	const canReachOutput = walk(
		outputs.map((node) => node.id),
		reverse
	);
	for (const [index, node] of nodes.entries())
		if (!reachable.has(node.id) || !canReachOutput.has(node.id))
			validator.issue(`$.nodes[${index}]`, 'invalid_graph');

	const indegree = new Map(nodes.map((node) => [node.id, reverse.get(node.id)!.length]));
	const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
	let visited = 0;
	for (let cursor = 0; cursor < queue.length; cursor++) {
		const current = queue[cursor];
		visited++;
		for (const target of adjacency.get(current) ?? []) {
			const next = indegree.get(target)! - 1;
			indegree.set(target, next);
			if (next === 0) queue.push(target);
		}
	}
	if (visited !== nodes.length) validator.issue('$.edges', 'invalid_graph');

	for (const [index, node] of nodes.entries()) {
		const template =
			node.type === 'model'
				? node.config.prompt
				: node.type === 'transform' && node.config.operation === 'template'
					? node.config.template
					: null;
		if (template !== null)
			validateTemplate(
				template,
				`$.nodes[${index}].config`,
				node.id,
				nodeById,
				adjacency,
				validator
			);
	}
}

function walk(starts: string[], adjacency: Map<string, string[]>): Set<string> {
	const seen = new Set<string>();
	const queue = [...starts];
	for (let cursor = 0; cursor < queue.length; cursor++) {
		const current = queue[cursor];
		if (seen.has(current)) continue;
		seen.add(current);
		queue.push(...(adjacency.get(current) ?? []));
	}
	return seen;
}

function validateTemplate(
	template: string,
	path: string,
	nodeId: string,
	nodes: Map<string, FlowNodeV1>,
	adjacency: Map<string, string[]>,
	validator: Validator
) {
	const referencePattern = /\{\{\s*([^{}]+?)\s*\}\}/g;
	for (const match of template.matchAll(referencePattern)) {
		const reference = /^node\.([A-Za-z][A-Za-z0-9_-]{0,63})\.output$/.exec(match[1]);
		if (!reference) {
			validator.issue(path, 'invalid_reference');
			continue;
		}
		const referenceId = reference[1];
		if (!nodes.has(referenceId) || !walk([referenceId], adjacency).has(nodeId))
			validator.issue(path, 'invalid_reference');
	}
	if (
		template.replace(referencePattern, '').includes('{{') ||
		template.replace(referencePattern, '').includes('}}')
	)
		validator.issue(path, 'invalid_reference');
}

function containsSecretMaterial(value: string): boolean {
	return (
		/^data:[^,]+,/i.test(value.trim()) ||
		/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/i.test(value) ||
		/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]/i.test(value)
	);
}
