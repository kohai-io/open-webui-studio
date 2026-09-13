export type FlowNodeRunState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface FlowExecutionNodeView {
	payload?: unknown;
	nodeId: string;
	state: FlowNodeRunState;
	errorCode: string | null;
}

export interface FlowExecutionNodeSource {
	payload?: unknown;
	nodeId: string;
	state: string;
	errorCode: string | null;
}

export interface FlowExecutionNodeEvent {
	sequence: number;
	nodeId: string | null;
	state: string | null;
	errorCode: string | null;
}

export function nodeExecutionStateMap(
	nodes: readonly FlowExecutionNodeSource[],
	events: readonly FlowExecutionNodeEvent[]
): ReadonlyMap<string, FlowExecutionNodeView> {
	const result = new Map<string, FlowExecutionNodeView>();
	for (const node of nodes) {
		const state = flowNodeRunState(node.state);
		if (state)
			result.set(node.nodeId, {
				nodeId: node.nodeId,
				state,
				errorCode: node.errorCode,
				...(node.payload === undefined ? {} : { payload: node.payload })
			});
	}
	for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
		if (!event.nodeId) continue;
		const state = flowNodeRunState(event.state);
		if (!state) continue;
		result.set(event.nodeId, {
			...(result.get(event.nodeId) ?? {}),
			nodeId: event.nodeId,
			state,
			errorCode: event.errorCode
		});
	}
	return result;
}

function flowNodeRunState(value: string | null): FlowNodeRunState | null {
	return value === 'pending' ||
		value === 'running' ||
		value === 'succeeded' ||
		value === 'failed' ||
		value === 'cancelled'
		? value
		: null;
}
