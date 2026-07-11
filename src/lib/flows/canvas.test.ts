import { describe, expect, it } from 'vitest';
import { buildLinearFlowDefinition, defaultLinearFlowDraft } from './linear';
import { flowDefinitionToCanvas, flowDefinitionWithCanvasPositions } from './canvas';
import type { FlowExecutionNodeView } from './execution-state';

describe('Flow canvas adapters', () => {
	it('projects saved configuration and separate execution state into typed view nodes', () => {
		const definition = buildLinearFlowDefinition({
			...defaultLinearFlowDraft('model-a'),
			transform: 'uppercase'
		});
		const execution = new Map<string, FlowExecutionNodeView>([
			['model', { nodeId: 'model', state: 'running', errorCode: null }]
		]);
		const view = flowDefinitionToCanvas(definition, execution);

		expect(view.nodes.map((node) => [node.id, node.data.label])).toEqual([
			['input', 'Input'],
			['model', 'Model'],
			['transform', 'Transform'],
			['output', 'Output']
		]);
		expect(view.nodes.find((node) => node.id === 'model')?.data).toMatchObject({
			summary: 'model-a',
			execution: { state: 'running' }
		});
		expect(definition.nodes.find((node) => node.id === 'model')).not.toHaveProperty('execution');
		expect(view.edges.map(({ source, target }) => `${source}-${target}`)).toEqual([
			'input-model',
			'model-transform',
			'transform-output'
		]);
	});

	it('writes only canvas positions back to a definition', () => {
		const definition = buildLinearFlowDefinition(defaultLinearFlowDraft('model-a'));
		const view = flowDefinitionToCanvas(definition);
		const moved = view.nodes.map((node) =>
			node.id === 'model' ? { ...node, position: { x: 412, y: 91 } } : node
		);
		const updated = flowDefinitionWithCanvasPositions(definition, moved);

		expect(updated.nodes.find((node) => node.id === 'model')).toEqual({
			...definition.nodes.find((node) => node.id === 'model'),
			position: { x: 412, y: 91 }
		});
		expect(updated.edges).toEqual(definition.edges);
		expect(definition.nodes.find((node) => node.id === 'model')?.position).toEqual({
			x: 300,
			y: 0
		});
	});
});
