import { describe, expect, it } from 'vitest';
import { nodeExecutionStateMap } from './execution-state';

describe('Flow node execution state map', () => {
	it('overlays ordered SSE node events without changing saved data', () => {
		const state = nodeExecutionStateMap(
			[
				{ nodeId: 'input', state: 'succeeded', errorCode: null },
				{ nodeId: 'model', state: 'pending', errorCode: null }
			],
			[
				{ sequence: 4, nodeId: 'model', state: 'succeeded', errorCode: null },
				{ sequence: 3, nodeId: 'model', state: 'running', errorCode: null },
				{ sequence: 5, nodeId: null, state: 'succeeded', errorCode: null }
			]
		);

		expect([...state.entries()]).toEqual([
			['input', { nodeId: 'input', state: 'succeeded', errorCode: null }],
			['model', { nodeId: 'model', state: 'succeeded', errorCode: null }]
		]);
	});
});
