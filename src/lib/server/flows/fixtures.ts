import type { FlowDefinitionV1 } from './definition';

export function validFlowDefinition(): FlowDefinitionV1 {
	return {
		schemaVersion: 1,
		nodes: [
			{
				id: 'input1',
				type: 'input',
				position: { x: 0, y: 0 },
				config: { key: 'request' }
			},
			{
				id: 'model1',
				type: 'model',
				position: { x: 240, y: 0 },
				config: {
					modelId: 'model-a',
					prompt: 'Summarise {{node.input1.output}}',
					temperature: 0.2,
					maxTokens: 512
				}
			},
			{
				id: 'transform1',
				type: 'transform',
				position: { x: 480, y: 0 },
				config: { operation: 'trim' }
			},
			{
				id: 'output1',
				type: 'output',
				position: { x: 720, y: 0 },
				config: { format: 'text' }
			}
		],
		edges: [
			{ id: 'edge1', source: 'input1', target: 'model1' },
			{ id: 'edge2', source: 'model1', target: 'transform1' },
			{ id: 'edge3', source: 'transform1', target: 'output1' }
		]
	};
}
