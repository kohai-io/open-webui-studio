import { describe, expect, it } from 'vitest';
import { FLOW_NODE_CATALOGUE, searchFlowNodeCatalogue } from './catalogue';

describe('Flow node catalogue', () => {
	it('returns the complete guided catalogue for an empty search', () => {
		expect(searchFlowNodeCatalogue('')).toEqual(FLOW_NODE_CATALOGUE);
	});

	it('matches names, descriptions, categories, and keywords across multiple terms', () => {
		expect(searchFlowNodeCatalogue('AI prompt').map((item) => item.type)).toEqual(['model']);
		expect(searchFlowNodeCatalogue('json format').map((item) => item.type)).toEqual(['transform']);
		expect(searchFlowNodeCatalogue('finish result').map((item) => item.type)).toEqual(['output']);
		expect(searchFlowNodeCatalogue('missing')).toEqual([]);
	});
});
