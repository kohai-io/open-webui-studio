import type { AdmittedFlowNodeType } from './editor';

export interface FlowNodeCatalogueItem {
	type: AdmittedFlowNodeType;
	name: string;
	category: 'Start' | 'AI' | 'Logic' | 'Finish';
	description: string;
	keywords: string[];
}

export const FLOW_NODE_CATALOGUE: readonly FlowNodeCatalogueItem[] = [
	{
		type: 'image',
		name: 'Image',
		category: 'AI',
		description: 'Generate or edit images using Open WebUI.',
		keywords: ['image', 'generate', 'edit', 'picture', 'sketch']
	},
	{
		type: 'input',
		name: 'Input',
		category: 'Start',
		description: 'Collect a named text value when the Flow starts.',
		keywords: ['start', 'parameter', 'value', 'request']
	},
	{
		type: 'model',
		name: 'Model',
		category: 'AI',
		description: 'Send a prompt to an available Open WebUI model.',
		keywords: ['ai', 'llm', 'prompt', 'completion']
	},
	{
		type: 'transform',
		name: 'Transform',
		category: 'Logic',
		description: 'Format, extract, replace, or combine earlier output.',
		keywords: ['template', 'text', 'json', 'format', 'replace']
	},
	{
		type: 'output',
		name: 'Output',
		category: 'Finish',
		description: 'Return the final text or JSON result.',
		keywords: ['finish', 'result', 'response', 'return']
	}
];

export function searchFlowNodeCatalogue(query: string): FlowNodeCatalogueItem[] {
	const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return [...FLOW_NODE_CATALOGUE];
	return FLOW_NODE_CATALOGUE.filter((item) => {
		const haystack = [item.name, item.category, item.description, ...item.keywords]
			.join(' ')
			.toLocaleLowerCase();
		return terms.every((term) => haystack.includes(term));
	});
}
