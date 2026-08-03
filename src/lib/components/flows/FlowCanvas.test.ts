import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import FlowCanvas from './FlowCanvas.svelte';
import { buildLinearFlowDefinition, defaultLinearFlowDraft } from '$lib/flows/linear';

describe('FlowCanvas', () => {
	it('renders the editable graph surface, editor toolbar, and viewport controls', () => {
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
				ondeleteedge: vi.fn(),
				onautolayout: vi.fn(),
				onundo: vi.fn(),
				onredo: vi.fn(),
				canUndo: true,
				canRedo: false
			}
		});

		expect(body).toContain('data-testid="flow-canvas"');
		expect(body).toContain('Flow canvas');
		expect(body).toContain('data-testid="svelte-flow__controls"');
		expect(body).toContain('svelte-flow__background');
		expect(body).toContain('svelte-flow__minimap');
		expect(body).toContain('Next after model');
		expect(body).toContain('Auto layout');
		expect(body).toContain('Undo');
		expect(body).toContain('Redo');
	});
});
