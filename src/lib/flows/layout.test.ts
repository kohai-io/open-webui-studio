import { describe, expect, it } from 'vitest';
import { autoLayoutFlowDefinition } from './layout';
import type { FlowDefinitionV1 } from './types';

describe('Flow auto-layout', () => {
	it('places a DAG in deterministic dependency columns and separates peers', () => {
		const definition: FlowDefinitionV1 = {
			schemaVersion: 1,
			nodes: [
				{ id: 'input', type: 'input', position: { x: 20, y: 20 }, config: { key: 'request' } },
				{
					id: 'model-a',
					type: 'model',
					position: { x: 10, y: 100 },
					config: { modelId: 'a', prompt: 'A' }
				},
				{
					id: 'model-b',
					type: 'model',
					position: { x: 10, y: -100 },
					config: { modelId: 'b', prompt: 'B' }
				},
				{
					id: 'merge',
					type: 'transform',
					position: { x: 10, y: 0 },
					config: { operation: 'template', template: '{{node.model-a.output}}' }
				},
				{ id: 'output', type: 'output', position: { x: 0, y: 0 }, config: { format: 'text' } }
			],
			edges: [
				{ id: 'input-a', source: 'input', target: 'model-a' },
				{ id: 'input-b', source: 'input', target: 'model-b' },
				{ id: 'a-merge', source: 'model-a', target: 'merge' },
				{ id: 'b-merge', source: 'model-b', target: 'merge' },
				{ id: 'merge-output', source: 'merge', target: 'output' }
			]
		};

		const laidOut = autoLayoutFlowDefinition(definition);
		const positions = Object.fromEntries(laidOut.nodes.map((node) => [node.id, node.position]));

		expect(positions.input.x).toBe(0);
		expect(positions['model-a'].x).toBe(300);
		expect(positions['model-b'].x).toBe(300);
		expect(positions['model-a'].y).not.toBe(positions['model-b'].y);
		expect(positions.merge.x).toBe(600);
		expect(positions.output.x).toBe(900);
		expect(laidOut.edges).toEqual(definition.edges);
		expect(laidOut.nodes.map((node) => node.config)).toEqual(
			definition.nodes.map((node) => node.config)
		);
		expect(autoLayoutFlowDefinition(laidOut)).toEqual(laidOut);
	});

	it('keeps invalid cyclic drafts visible in a final fallback column', () => {
		const definition: FlowDefinitionV1 = {
			schemaVersion: 1,
			nodes: [
				{ id: 'a', type: 'input', position: { x: 0, y: 0 }, config: { key: 'a' } },
				{ id: 'b', type: 'output', position: { x: 0, y: 0 }, config: { format: 'text' } }
			],
			edges: [
				{ id: 'a-b', source: 'a', target: 'b' },
				{ id: 'b-a', source: 'b', target: 'a' }
			]
		};

		const laidOut = autoLayoutFlowDefinition(definition);

		expect(laidOut.nodes).toHaveLength(2);
		expect(new Set(laidOut.nodes.map((node) => node.position.x))).toEqual(new Set([300]));
		expect(laidOut.nodes[0].position.y).not.toBe(laidOut.nodes[1].position.y);
	});
});
