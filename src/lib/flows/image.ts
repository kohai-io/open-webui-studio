import type { FlowDefinitionV1 } from './types';
export function imageFlowDefinition(operation: 'generate' | 'edit'): FlowDefinitionV1 {
	return {
		schemaVersion: 1,
		nodes: [
			{ id: 'input', type: 'input', position: { x: 0, y: 0 }, config: { key: 'prompt' } },
			...(operation === 'edit'
				? [
						{
							id: 'references',
							type: 'input' as const,
							position: { x: 0, y: 180 },
							config: { key: 'images', kind: 'images' as const }
						}
					]
				: []),
			{
				id: 'image',
				type: 'image',
				position: { x: 320, y: 0 },
				config: { operation, prompt: '{{node.input.output}}' }
			},
			{ id: 'output', type: 'output', position: { x: 640, y: 0 }, config: { format: 'images' } }
		],
		edges: [
			{ id: 'prompt-image', source: 'input', target: 'image' },
			...(operation === 'edit'
				? [{ id: 'references-image', source: 'references', target: 'image' }]
				: []),
			{ id: 'image-output', source: 'image', target: 'output' }
		]
	};
}
