import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import FlowCanvas from './FlowCanvas.svelte';
import { buildLinearFlowDefinition, defaultLinearFlowDraft } from '$lib/flows/linear';

describe('FlowCanvas', () => {
	it('renders the locked graph surface with its viewport controls', () => {
		const { body } = render(FlowCanvas, {
			props: {
				definition: buildLinearFlowDefinition(defaultLinearFlowDraft('model-a')),
				executionByNodeId: new Map(),
				onselect: vi.fn(),
				onpositionchange: vi.fn()
			}
		});

		expect(body).toContain('data-testid="flow-canvas"');
		expect(body).toContain('Flow canvas');
		expect(body).toContain('data-testid="svelte-flow__controls"');
		expect(body).toContain('svelte-flow__background');
		expect(body).toContain('svelte-flow__minimap');
	});
});
