import type { FlowDefinitionV1 } from './types';

export function appendImageEdit(
	definition: FlowDefinitionV1
): { definition: FlowDefinitionV1; nodeId: string } | null {
	const output = definition.nodes.find(
		(node) => node.type === 'output' && node.config.format === 'images'
	);
	const incoming = definition.edges.filter((edge) => edge.target === output?.id);
	const source = definition.nodes.find((node) => node.id === incoming[0]?.source);
	if (!output || incoming.length !== 1 || source?.type !== 'image' || definition.nodes.length >= 50)
		return null;
	let nodeId = 'edit';
	for (let suffix = 2; definition.nodes.some((node) => node.id === nodeId); suffix++)
		nodeId = `edit-${suffix}`;
	const edges = definition.edges.filter((edge) => edge.id !== incoming[0].id);
	const edgeId = (suffix: string) => {
		let id = `${nodeId}-${suffix}`;
		while (edges.some((edge) => edge.id === id)) id += '-next';
		return id;
	};
	edges.push({ id: edgeId('input'), source: source.id, target: nodeId });
	edges.push({ id: edgeId('output'), source: nodeId, target: output.id });
	return {
		nodeId,
		definition: {
			...definition,
			nodes: [
				...definition.nodes.map((node) =>
					node.id === output.id
						? { ...node, position: { x: source.position.x + 640, y: source.position.y } }
						: node
				),
				{
					id: nodeId,
					type: 'image',
					position: { x: source.position.x + 320, y: source.position.y },
					config: { operation: 'edit', prompt: 'Describe the changes to make.' }
				}
			],
			edges
		}
	};
}
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
