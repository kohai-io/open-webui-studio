import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openStudioDatabase } from '$lib/server/database/database';
import { flowEventStream, parseEventCursor } from './event-stream';
import { FlowExecutionStore } from './executions';
import { validFlowDefinition } from './fixtures';
import { FlowStore } from './store';

describe('flowEventStream', () => {
	it('emits ordered terminal metadata without retained input data', async () => {
		const database = openStudioDatabase(':memory:');
		const flows = new FlowStore(database, { now: () => 1_000, nextId: () => 'flow-1' });
		const flow = flows.create('user-a', {
			name: 'Events',
			definition: validFlowDefinition()
		});
		const executions = new FlowExecutionStore({
			database,
			encryptionKey: randomBytes(32),
			now: () => 1_000,
			nextId: () => 'execution-1'
		});
		const execution = executions.create('user-a', flow.id, {
			idempotencyKey: 'request-1',
			inputs: { request: 'private input' }
		});
		executions.requestCancel('user-a', execution.id);

		const body = await new Response(
			flowEventStream(executions, 'user-a', execution.id, 0, new AbortController().signal)
		).text();
		expect(body).toContain('retry: 1000');
		expect(body).toContain('event: flow');
		expect(body).toContain('"state":"cancelled"');
		expect(body).not.toContain('private input');
		expect([...body.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]))).toEqual(
			executions.events('user-a', execution.id).map((event) => event.sequence)
		);
		database.close();
	});

	it('validates reconnect cursors', () => {
		expect(parseEventCursor(null)).toBe(0);
		expect(parseEventCursor('12')).toBe(12);
		expect(() => parseEventCursor('-1')).toThrow(TypeError);
		expect(() => parseEventCursor('1.5')).toThrow(TypeError);
	});
});
