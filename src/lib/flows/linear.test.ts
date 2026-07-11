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
});
