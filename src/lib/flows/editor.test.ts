import { describe, expect, it } from 'vitest';
import { buildLinearFlowDefinition, defaultLinearFlowDraft } from './linear';
import {
	addFlowNode,
	connectFlowNodes,
	flowConnectionError,
	flowEditorIssues,
	removeFlowNode,
	replaceFlowNode
} from './editor';

describe('editable Flow graph', () => {
	it('adds admitted nodes at deterministic positions with typed defaults', () => {
		const definition = buildLinearFlowDefinition(defaultLinearFlowDraft('model-a'));
		const added = addFlowNode(definition, 'transform', 'model-a');
		expect(added?.nodeId).toBe('transform');
		expect(added?.definition.nodes.at(-1)).toEqual({
			id: 'transform',
			type: 'transform',
			position: { x: 1200, y: 0 },
			config: { operation: 'trim' }
		});
		expect(addFlowNode(definition, 'output')).toBeNull();
	});

	it('connects nodes, rejects duplicates and cycles, and removes incident edges', () => {
		const definition = buildLinearFlowDefinition(defaultLinearFlowDraft('model-a'));
		const added = addFlowNode(definition, 'transform');
		if (!added) throw new Error('fixture mismatch');
		const connected = connectFlowNodes(added.definition, {
			source: 'model',
			target: added.nodeId
		});
		expect(connected.error).toBeNull();
		expect(
			flowConnectionError(connected.definition, { source: added.nodeId, target: 'input' })
		).toBe('Input nodes cannot receive a connection.');
		expect(
			flowConnectionError(connected.definition, { source: added.nodeId, target: 'model' })
		).toBe('That connection would create a cycle.');
		expect(removeFlowNode(connected.definition, added.nodeId).edges).toEqual(definition.edges);
	});

	it('reports incomplete topology and accepts a rewired admitted graph', () => {
		let definition = buildLinearFlowDefinition(defaultLinearFlowDraft('model-a'));
		definition = { ...definition, edges: [] };
		expect(flowEditorIssues(definition)).toContain('Connect input to a later node.');
		definition = connectFlowNodes(definition, { source: 'input', target: 'model' }).definition;
		definition = connectFlowNodes(definition, { source: 'model', target: 'output' }).definition;
		expect(flowEditorIssues(definition)).toEqual([]);

		const model = definition.nodes.find((node) => node.type === 'model');
		if (!model) throw new Error('fixture mismatch');
		definition = replaceFlowNode(definition, {
			...model,
			config: { ...model.config, temperature: 0.4, maxTokens: 512 }
		});
		expect(definition.nodes.find((node) => node.id === model.id)).toMatchObject({
			config: { temperature: 0.4, maxTokens: 512 }
		});
	});
});
