import type { FlowDefinitionV1 } from './types';

export interface FlowEditorHistory {
	past: FlowDefinitionV1[];
	present: FlowDefinitionV1;
	future: FlowDefinitionV1[];
}

const DEFAULT_HISTORY_LIMIT = 100;

export function createFlowEditorHistory(definition: FlowDefinitionV1): FlowEditorHistory {
	return {
		past: [],
		present: clone(definition),
		future: []
	};
}

export function commitFlowEditorHistory(
	history: FlowEditorHistory,
	definition: FlowDefinitionV1,
	limit = DEFAULT_HISTORY_LIMIT
): FlowEditorHistory {
	if (sameDefinition(history.present, definition)) return history;
	const past = [...history.past, clone(history.present)];
	return {
		past: past.slice(Math.max(0, past.length - Math.max(1, limit))),
		present: clone(definition),
		future: []
	};
}

export function undoFlowEditorHistory(history: FlowEditorHistory): FlowEditorHistory {
	const previous = history.past.at(-1);
	if (!previous) return history;
	return {
		past: history.past.slice(0, -1),
		present: clone(previous),
		future: [clone(history.present), ...history.future]
	};
}

export function redoFlowEditorHistory(history: FlowEditorHistory): FlowEditorHistory {
	const next = history.future[0];
	if (!next) return history;
	return {
		past: [...history.past, clone(history.present)],
		present: clone(next),
		future: history.future.slice(1)
	};
}

function sameDefinition(left: FlowDefinitionV1, right: FlowDefinitionV1): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function clone(definition: FlowDefinitionV1): FlowDefinitionV1 {
	return structuredClone(definition);
}
