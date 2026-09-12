export const FLOW_DEFINITION_SCHEMA_VERSION = 1 as const;

export interface FlowPositionV1 {
	x: number;
	y: number;
}

interface FlowNodeBaseV1 {
	id: string;
	position: FlowPositionV1;
}

export interface FlowInputNodeV1 extends FlowNodeBaseV1 {
	type: 'input';
	config: { key: string; defaultValue?: string; kind?: 'text' | 'images' };
}

export interface FlowModelNodeV1 extends FlowNodeBaseV1 {
	type: 'model';
	config: { modelId: string; prompt: string; temperature?: number; maxTokens?: number };
}

export type FlowTransformConfigV1 =
	| { operation: 'uppercase' | 'lowercase' | 'trim' }
	| { operation: 'replace'; search: string; replacement: string }
	| { operation: 'extract'; path: string }
	| { operation: 'template'; template: string };

export interface FlowTransformNodeV1 extends FlowNodeBaseV1 {
	type: 'transform';
	config: FlowTransformConfigV1;
}

export interface FlowOutputNodeV1 extends FlowNodeBaseV1 {
	type: 'output';
	config: { format: 'text' | 'json' | 'images' };
}

export interface FlowImageNodeV1 extends FlowNodeBaseV1 {
	type: 'image';
	config: {
		operation: 'generate' | 'edit';
		prompt: string;
		size?: '1024x1024' | '1536x1024' | '1024x1536';
	};
}
export interface FlowImages {
	kind: 'images';
	fileIds: string[];
}
export type FlowInputValue = string | FlowImages;
export type FlowNodeV1 =
	FlowInputNodeV1 | FlowModelNodeV1 | FlowTransformNodeV1 | FlowOutputNodeV1 | FlowImageNodeV1;

export function isFlowImages(value: unknown): value is FlowImages {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const v = value as Record<string, unknown>;
	return (
		Object.keys(v).every((key) => key === 'kind' || key === 'fileIds') &&
		v.kind === 'images' &&
		Array.isArray(v.fileIds) &&
		v.fileIds.length > 0 &&
		v.fileIds.length <= 8 &&
		v.fileIds.every((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id)) &&
		new Set(v.fileIds).size === v.fileIds.length
	);
}

export interface FlowEdgeV1 {
	id: string;
	source: string;
	target: string;
}

export interface FlowDefinitionV1 {
	schemaVersion: typeof FLOW_DEFINITION_SCHEMA_VERSION;
	nodes: FlowNodeV1[];
	edges: FlowEdgeV1[];
}

export function producesImages(node: FlowNodeV1): boolean {
	return node.type === 'image' || (node.type === 'input' && node.config.kind === 'images');
}
export function imageConnectionError(source: FlowNodeV1, target: FlowNodeV1): string | null {
	const image = producesImages(source);
	if (target.type === 'output' && (target.config.format === 'images') !== image)
		return 'Choose an Output format that matches its input.';
	if (
		image &&
		!(target.type === 'image' && target.config.operation === 'edit') &&
		target.type !== 'output'
	)
		return 'Connect images to an Edit image node or an Images output.';
	return null;
}
