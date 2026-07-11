import { describe, expect, it } from 'vitest';
import { validateFlowDefinition } from '$lib/server/flows/definition';
import {
	buildLinearFlowDefinition,
	defaultLinearFlowDraft,
	linearFlowDraftFromRecord
} from './linear';

describe('linear Flow editor model', () => {
	it('builds a valid three-node Flow without a transform', () => {
		const draft = {
			...defaultLinearFlowDraft('model-a'),
			name: 'Summarise',
			description: 'A short summary'
		};
		const definition = buildLinearFlowDefinition(draft);
		expect(validateFlowDefinition(definition)).toEqual(definition);
		expect(definition.nodes.map((node) => node.type)).toEqual(['input', 'model', 'output']);
		expect(
			linearFlowDraftFromRecord({
				name: draft.name,
				description: draft.description,
				definition
			})
		).toEqual(draft);
	});

	it('round-trips an allowlisted transform and rejects unsupported graph shapes', () => {
		const draft = {
			...defaultLinearFlowDraft('model-a'),
			name: 'Uppercase',
			transform: 'uppercase' as const
		};
		const definition = buildLinearFlowDefinition(draft);
		expect(validateFlowDefinition(definition)).toEqual(definition);
		expect(linearFlowDraftFromRecord({ ...draft, definition })).toEqual(draft);

		const unsupported = structuredClone(definition);
		const transform = unsupported.nodes.find((node) => node.type === 'transform');
		if (!transform || transform.type !== 'transform') throw new Error('fixture mismatch');
		(transform.config as { operation: string }).operation = 'template';
		expect(linearFlowDraftFromRecord({ ...draft, definition: unsupported })).toBeNull();

		const configuredModel = buildLinearFlowDefinition(draft);
		const model = configuredModel.nodes.find((node) => node.type === 'model');
		if (!model || model.type !== 'model') throw new Error('fixture mismatch');
		(model.config as { temperature?: number }).temperature = 0.4;
		expect(linearFlowDraftFromRecord({ ...draft, definition: configuredModel })).toBeNull();
	});

	it('preserves saved positions and deterministically places a newly enabled transform', () => {
		const draft = defaultLinearFlowDraft('model-a');
		draft.positions.input = { x: -120, y: 75 };
		draft.positions.model = { x: 260, y: -40 };
		draft.positions.output = { x: 940, y: 160 };
		const definition = buildLinearFlowDefinition(draft);
		const restored = linearFlowDraftFromRecord({ name: 'Positioned', definition });

		expect(restored?.positions).toEqual({
			input: { x: -120, y: 75 },
			model: { x: 260, y: -40 },
			transform: { x: 600, y: 60 },
			output: { x: 940, y: 160 }
		});
		if (!restored) throw new Error('fixture mismatch');
		restored.transform = 'trim';
		const withTransform = buildLinearFlowDefinition(restored);
		expect(withTransform.nodes.find((node) => node.id === 'transform')?.position).toEqual({
			x: 600,
			y: 60
		});
		expect(withTransform.nodes.find((node) => node.id === 'output')?.position).toEqual({
			x: 940,
			y: 160
		});
	});
});
