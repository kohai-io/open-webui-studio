import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import FlowNodeConfig from './FlowNodeConfig.svelte';

describe('FlowNodeConfig', () => {
	it('renders admitted Model settings inside the canvas editor', () => {
		const { body } = render(FlowNodeConfig, {
			props: {
				node: {
					id: 'model',
					type: 'model',
					position: { x: 300, y: 0 },
					config: {
						modelId: 'model-a',
						prompt: 'Respond to {{node.input.output}}',
						temperature: 0.4,
						maxTokens: 512
					}
				},
				models: [{ id: 'model-a', name: 'Model A' }],
				predecessorIds: ['input'],
				onupdate: vi.fn(),
				ondelete: vi.fn(),
				onclose: vi.fn()
			}
		});

		expect(body).toContain('model settings');
		expect(body).toContain('Prompt template');
		expect(body).toContain('Temperature');
		expect(body).toContain('Delete node');
	});
});
