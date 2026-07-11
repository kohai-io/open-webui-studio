import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { openStudioDatabase } from '$lib/server/database/database';
import type { StoredSession } from '$lib/server/sessions/store';
import { FlowCredentialLeaseError, FlowCredentialLeaseStore } from './credential-leases';
import { FlowExecutionStore } from './executions';
import { validFlowDefinition } from './fixtures';
import { FlowQueueError, FlowQueueService } from './queue';
import { FlowStore } from './store';

describe('FlowQueueService', () => {
	it('atomically creates an execution and a session-bounded credential lease', () => {
		const harness = createHarness();
		const execution = harness.queue.enqueue(session(), harness.flowId, {
			idempotencyKey: 'request-1',
			inputs: { request: 'private input' }
		});

		expect(execution).toMatchObject({ state: 'queued', inputs: { request: 'private input' } });
		expect(harness.onQueued).toHaveBeenCalledTimes(1);
		expect(
			harness.database
				.prepare(
					`SELECT expires_at, encrypted_credential
					 FROM studio_flow_credential_lease WHERE execution_id = ?`
				)
				.get(execution.id)
		).toEqual({
			expires_at: 1_500,
			encrypted_credential: expect.not.stringContaining('private-token')
		});
		harness.close();
	});

	it('rolls back execution creation when credential issuance fails', () => {
		const harness = createHarness();
		vi.spyOn(harness.credentialLeases, 'issue').mockImplementation(() => {
			throw new FlowCredentialLeaseError('invalid_credential');
		});

		expectQueueError(
			() =>
				harness.queue.enqueue(session(), harness.flowId, {
					idempotencyKey: 'request-1',
					inputs: { request: 'hello' }
				}),
			'authentication_required'
		);
		expect(tableCount(harness.database, 'studio_flow_execution')).toBe(0);
		expect(tableCount(harness.database, 'studio_flow_execution_node')).toBe(0);
		expect(tableCount(harness.database, 'studio_flow_event')).toBe(0);
		expect(harness.onQueued).not.toHaveBeenCalled();
		harness.close();
	});

	it('returns an idempotent queued execution without rotating its credential', () => {
		const harness = createHarness();
		const issue = vi.spyOn(harness.credentialLeases, 'issue');
		const first = harness.queue.enqueue(session(), harness.flowId, {
			idempotencyKey: 'request-1',
			inputs: { request: 'first' }
		});
		const duplicate = harness.queue.enqueue(
			{ ...session(), owuiToken: 'replacement-token' },
			harness.flowId,
			{
				idempotencyKey: 'request-1',
				inputs: { request: 'different' }
			}
		);

		expect(duplicate.id).toBe(first.id);
		expect(duplicate.inputs).toEqual({ request: 'first' });
		expect(issue).toHaveBeenCalledTimes(1);
		expect(tableCount(harness.database, 'studio_flow_execution')).toBe(1);
		expect(tableCount(harness.database, 'studio_flow_credential_lease')).toBe(1);
		harness.close();
	});

	it('rejects expired sessions and cross-owner flows without partial rows', () => {
		const harness = createHarness();
		expectQueueError(
			() =>
				harness.queue.enqueue({ ...session(), expiresAt: 1_000 }, harness.flowId, {
					idempotencyKey: 'expired',
					inputs: { request: 'hello' }
				}),
			'authentication_required'
		);
		expectQueueError(
			() =>
				harness.queue.enqueue({ ...session(), owuiUserId: 'user-b' }, harness.flowId, {
					idempotencyKey: 'cross-owner',
					inputs: { request: 'hello' }
				}),
			'not_found'
		);
		expect(tableCount(harness.database, 'studio_flow_execution')).toBe(0);
		harness.close();
	});
});

function createHarness() {
	const database = openStudioDatabase(':memory:');
	const encryptionKey = randomBytes(32);
	const flows = new FlowStore(database, { now: () => 1_000, nextId: () => 'flow-1' });
	const flowId = flows.create('user-a', {
		name: 'Queued flow',
		definition: validFlowDefinition()
	}).id;
	const executions = new FlowExecutionStore({
		database,
		encryptionKey,
		now: () => 1_000,
		nextId: () => 'execution-1'
	});
	const credentialLeases = new FlowCredentialLeaseStore({
		database,
		encryptionKey,
		now: () => 1_000
	});
	const onQueued = vi.fn();
	const queue = new FlowQueueService({
		database,
		executions,
		credentialLeases,
		now: () => 1_000,
		onQueued
	});
	return {
		database,
		flowId,
		credentialLeases,
		queue,
		onQueued,
		close: () => database.close()
	};
}

function session(): StoredSession {
	return {
		handle: 'browser-session-handle',
		issuer: 'https://issuer.test',
		subject: 'subject-a',
		owuiUserId: 'user-a',
		owuiToken: 'private-token',
		owuiTokenExpiresAt: 1_800,
		expiresAt: 2_000,
		idleExpiresAt: 1_500
	};
}

function tableCount(database: ReturnType<typeof openStudioDatabase>, table: string): number {
	return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
		.count;
}

function expectQueueError(run: () => unknown, code: string) {
	try {
		run();
		throw new Error('expected operation to fail');
	} catch (error) {
		expect(error).toBeInstanceOf(FlowQueueError);
		expect(error).toMatchObject({ code });
	}
}
