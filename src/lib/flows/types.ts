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
	config: { key: string; defaultValue?: string };
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
	config: { format: 'text' | 'json' };
}

export type FlowNodeV1 = FlowInputNodeV1 | FlowModelNodeV1 | FlowTransformNodeV1 | FlowOutputNodeV1;

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
