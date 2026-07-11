import type { FlowExecutionStore } from './executions';

export function parseEventCursor(value: string | null): number {
	if (value === null || value === '') return 0;
	const cursor = Number(value);
	if (!Number.isSafeInteger(cursor) || cursor < 0) throw new TypeError('invalid event cursor');
	return cursor;
}

export function flowEventStream(
	executions: FlowExecutionStore,
	ownerOwuiUserId: string,
	executionId: string,
	afterSequence: number,
	signal: AbortSignal,
	pollIntervalMs = 500
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let cursor = afterSequence;
	let closed = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let controller: ReadableStreamDefaultController<Uint8Array>;
	const close = () => {
		if (closed) return;
		closed = true;
		if (timer) clearTimeout(timer);
		signal.removeEventListener('abort', close);
		controller.close();
	};
	const poll = () => {
		if (closed || signal.aborted) {
			close();
			return;
		}
		try {
			for (const event of executions.events(ownerOwuiUserId, executionId, cursor)) {
				cursor = event.sequence;
				controller.enqueue(
					encoder.encode(`id: ${event.sequence}\nevent: flow\ndata: ${JSON.stringify(event)}\n\n`)
				);
			}
			const execution = executions.get(ownerOwuiUserId, executionId);
			if (!execution || ['succeeded', 'failed', 'cancelled'].includes(execution.state)) {
				close();
				return;
			}
			timer = setTimeout(poll, pollIntervalMs);
			timer.unref?.();
		} catch {
			close();
		}
	};
	return new ReadableStream<Uint8Array>({
		start(streamController) {
			controller = streamController;
			controller.enqueue(encoder.encode('retry: 1000\n\n'));
			signal.addEventListener('abort', close, { once: true });
			poll();
		},
		cancel() {
			if (timer) clearTimeout(timer);
			signal.removeEventListener('abort', close);
			closed = true;
		}
	});
}
