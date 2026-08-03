import { describe, expect, it } from 'vitest';
import { buildLinearFlowDefinition, defaultLinearFlowDraft } from './linear';
import {
	commitFlowEditorHistory,
	createFlowEditorHistory,
	redoFlowEditorHistory,
	undoFlowEditorHistory
} from './history';

describe('Flow editor history', () => {
	it('undoes and redoes canonical definitions without sharing mutable state', () => {
		const initial = buildLinearFlowDefinition(defaultLinearFlowDraft('model-a'));
		const moved = structuredClone(initial);
		moved.nodes[1].position = { x: 475, y: 120 };

		const committed = commitFlowEditorHistory(createFlowEditorHistory(initial), moved);
		const undone = undoFlowEditorHistory(committed);
		const redone = redoFlowEditorHistory(undone);

		expect(undone.present).toEqual(initial);
		expect(redone.present).toEqual(moved);
		expect(redone.present).not.toBe(moved);
		expect(redone.present.nodes[1]).not.toBe(moved.nodes[1]);
	});

	it('clears the redo branch after a new edit and ignores identical definitions', () => {
		const initial = buildLinearFlowDefinition(defaultLinearFlowDraft('model-a'));
		const moved = structuredClone(initial);
		moved.nodes[1].position.x = 475;
		const committed = commitFlowEditorHistory(createFlowEditorHistory(initial), moved);
		const undone = undoFlowEditorHistory(committed);
		const renamedInput = structuredClone(initial);
		const input = renamedInput.nodes.find((node) => node.type === 'input');
		if (!input || input.type !== 'input') throw new Error('fixture mismatch');
		input.config.key = 'question';

		const branched = commitFlowEditorHistory(undone, renamedInput);

		expect(branched.future).toEqual([]);
		expect(redoFlowEditorHistory(branched)).toBe(branched);
		expect(commitFlowEditorHistory(branched, structuredClone(renamedInput))).toBe(branched);
	});

	it('bounds retained history', () => {
		const initial = buildLinearFlowDefinition(defaultLinearFlowDraft('model-a'));
		let history = createFlowEditorHistory(initial);
		for (let x = 1; x <= 5; x++) {
			const next = structuredClone(history.present);
			next.nodes[0].position.x = x;
			history = commitFlowEditorHistory(history, next, 3);
		}

		expect(history.past).toHaveLength(3);
		expect(history.past.map((definition) => definition.nodes[0].position.x)).toEqual([2, 3, 4]);
	});
});
