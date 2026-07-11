import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import FlowCanvas from './FlowCanvas.svelte';
import { buildLinearFlowDefinition, defaultLinearFlowDraft } from '$lib/flows/linear';

describe('FlowCanvas', () => {
	it('renders the editable graph surface, node library, and viewport controls', () => {
		const { body } = render(FlowCanvas, {
			props: {
				definition: buildLinearFlowDefinition(defaultLinearFlowDraft('model-a')),
				executionByNodeId: new Map(),
				selectedNodeId: 'model',
				selectedEdgeId: null,
				onselect: vi.fn(),
				onselectedge: vi.fn(),
				onclearselection: vi.fn(),
				onpositionchange: vi.fn(),
				onconnectnodes: vi.fn(),
				onaddnode: vi.fn(),
				ondeleteedge: vi.fn()
			}
		});

		expect(body).toContain('data-testid="flow-canvas"');
		expect(body).toContain('Flow canvas');
		expect(body).toContain('data-testid="svelte-flow__controls"');
		expect(body).toContain('svelte-flow__background');
		expect(body).toContain('svelte-flow__minimap');
		expect(body).toContain('Add node');
		expect(body).toContain('Transform');
	});
});
