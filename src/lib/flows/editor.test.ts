import { describe, expect, it } from 'vitest';
import { buildLinearFlowDefinition, defaultLinearFlowDraft } from './linear';
import {
	addFlowNode,
	addFlowNodeAfter,
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

	it('inserts a guided node into a single path and branches when the path already splits', () => {
		const definition = buildLinearFlowDefinition(defaultLinearFlowDraft('model-a'));
		const inserted = addFlowNodeAfter(definition, 'model', 'transform');
		if (!inserted) throw new Error('fixture mismatch');

		expect(inserted.error).toBeNull();
		expect(inserted.insertedBeforeNodeId).toBe('output');
		expect(inserted.definition.edges.map(({ source, target }) => `${source}-${target}`)).toEqual([
			'input-model',
			'model-transform',
			'transform-output'
		]);

		const extra = addFlowNode(inserted.definition, 'transform');
		if (!extra) throw new Error('fixture mismatch');
		const split = connectFlowNodes(extra.definition, {
			source: 'model',
			target: extra.nodeId
		});
		if (split.error) throw new Error('fixture mismatch');
		const branched = addFlowNodeAfter(split.definition, 'model', 'model', 'model-a');
		if (!branched) throw new Error('fixture mismatch');
		expect(branched.error).toBeNull();
		expect(branched.insertedBeforeNodeId).toBeNull();
		expect(
			branched.definition.edges.some(
				(edge) => edge.source === 'model' && edge.target === branched.nodeId
			)
		).toBe(true);
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
