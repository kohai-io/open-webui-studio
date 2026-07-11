import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openStudioDatabase, type StudioDatabase } from '$lib/server/database/database';
import { FlowCredentialLeaseStore } from './credential-leases';
import { FlowExecutionError, FlowExecutionStore } from './executions';
import { validFlowDefinition } from './fixtures';
import { FlowStore } from './store';

describe('FlowExecutionStore', () => {
	it('creates an encrypted execution pinned to an immutable flow version', () => {
		const harness = createHarness();
		const flow = harness.createFlow('user-a');
		const execution = harness.executions.create('user-a', flow.id, {
			idempotencyKey: 'request-1',
			inputs: { request: 'private input' }
		});

		expect(execution).toMatchObject({
			id: 'execution-1',
			flowId: flow.id,
			flowVersion: 1,
			state: 'queued',
			inputs: { request: 'private input' }
		});
		expect(execution.nodes.map((node) => [node.nodeId, node.nodeOrder, node.state])).toEqual([
			['input1', 1, 'pending'],
			['model1', 2, 'pending'],
			['transform1', 3, 'pending'],
			['output1', 4, 'pending']
		]);
		const stored = harness.database
			.prepare(`SELECT encrypted_input FROM studio_flow_execution WHERE id = 'execution-1'`)
			.get() as { encrypted_input: string };
		expect(stored.encrypted_input).not.toContain('private input');
		expect(harness.executions.events('user-a', execution.id)).toMatchObject([
			{ sequence: 1, eventType: 'execution', state: 'queued' }
		]);

		harness.flows.update('user-a', flow.id, {
			expectedRevision: 1,
			name: 'Changed after queue'
		});
		const claim = harness.executions.claimNext('worker-a')!;
		expect(claim.flowVersion).toBe(1);
		expect(claim.definition).toEqual(validFlowDefinition());
		harness.close();
	});

	it('returns the original execution for an owner-scoped idempotency key', () => {
		const harness = createHarness();
		const firstFlow = harness.createFlow('user-a');
		const secondFlow = harness.createFlow('user-a');
		const first = harness.executions.create('user-a', firstFlow.id, {
			idempotencyKey: 'same-request',
			inputs: { request: 'first' }
		});
		const duplicate = harness.executions.create('user-a', secondFlow.id, {
			idempotencyKey: 'same-request',
			inputs: { request: 'different' }
		});

		expect(duplicate.id).toBe(first.id);
		expect(duplicate.flowId).toBe(firstFlow.id);
		expect(duplicate.inputs).toEqual({ request: 'first' });
		expect(executionCount(harness.database)).toBe(1);
		harness.close();
	});

	it('validates runtime inputs before persisting any execution data', () => {
		const harness = createHarness();
		const flow = harness.createFlow('user-a');
		expectExecutionError(
			() =>
				harness.executions.create('user-a', flow.id, {
					idempotencyKey: 'unknown-input',
					inputs: { request: 'hello', extra: 'not allowed' }
				}),
			'validation_failed',
			'$.inputs.extra'
		);
		expectExecutionError(
			() =>
				harness.executions.create('user-a', flow.id, {
					idempotencyKey: 'missing-input',
					inputs: {}
				}),
			'validation_failed',
			'$.inputs.request'
		);
		expect(executionCount(harness.database)).toBe(0);
		harness.close();
	});

	it('hides reads, events, and cancellation from other users', () => {
		const harness = createHarness();
		const flow = harness.createFlow('user-a');
		const execution = harness.queue('user-a', flow.id, 'private-run');

		expect(harness.executions.get('user-b', execution.id)).toBeNull();
		expect(harness.executions.list('user-b')).toEqual([]);
		expectExecutionError(() => harness.executions.events('user-b', execution.id), 'not_found');
		expectExecutionError(
			() => harness.executions.requestCancel('user-b', execution.id),
			'not_found'
		);
		expect(harness.executions.get('user-a', execution.id)?.state).toBe('queued');
		harness.close();
	});

	it('atomically limits claims globally and to one active execution per owner', () => {
		const harness = createHarness({ maxConcurrent: 2 });
		const flowA = harness.createFlow('user-a');
		const flowB = harness.createFlow('user-b');
		const firstA = harness.queue('user-a', flowA.id, 'a-1');
		harness.queue('user-a', flowA.id, 'a-2');
		const firstB = harness.queue('user-b', flowB.id, 'b-1');

		const claimA = harness.executions.claimNext('worker-a')!;
		const claimB = harness.executions.claimNext('worker-b')!;
		expect(claimA.id).toBe(firstA.id);
		expect(claimB.id).toBe(firstB.id);
		expect(harness.executions.claimNext('worker-c')).toBeNull();
		expect(
			harness.database
				.prepare("SELECT COUNT(*) AS count FROM studio_flow_execution WHERE state = 'running'")
				.get()
		).toEqual({ count: 2 });
		harness.close();
	});

	it('stores only the claim hash and rejects wrong, expired, or cross-execution claims', () => {
		const harness = createHarness({ claimTtlMs: 100 });
		const flow = harness.createFlow('user-a');
		harness.queue('user-a', flow.id, 'run-a');
		harness.queue('user-a', flow.id, 'run-b');
		const claim = harness.executions.claimNext('worker-a')!;
		const stored = harness.database
			.prepare(`SELECT claim_token_hash FROM studio_flow_execution WHERE id = ?`)
			.get(claim.id) as { claim_token_hash: string };
		expect(stored.claim_token_hash).not.toBe(claim.claimToken);
		expect(stored.claim_token_hash).toHaveLength(64);
		expectExecutionError(() => harness.executions.heartbeat(claim.id, 'wrong-token'), 'lost_claim');
		expectExecutionError(
			() => harness.executions.beginNode('execution-2', claim.claimToken, 'input1'),
			'lost_claim'
		);

		harness.advance(99);
		expect(harness.executions.heartbeat(claim.id, claim.claimToken)).toEqual({
			cancelRequested: false
		});
		harness.advance(101);
		expectExecutionError(
			() => harness.executions.beginNode(claim.id, claim.claimToken, 'input1'),
			'lost_claim'
		);
		harness.close();
	});

	it('writes encrypted checkpoints in deterministic order and commits one success', () => {
		const harness = createHarness();
		const flow = harness.createFlow('user-a');
		harness.queue('user-a', flow.id, 'successful-run');
		const claim = harness.executions.claimNext('worker-a')!;

		expectExecutionError(
			() => harness.executions.beginNode(claim.id, claim.claimToken, 'model1'),
			'conflict'
		);
		expectExecutionError(
			() => harness.executions.finishSucceeded(claim.id, claim.claimToken, 'too early'),
			'conflict'
		);
		for (const node of claim.nodes) {
			const started = harness.executions.beginNode(claim.id, claim.claimToken, node.nodeId);
			expect(started).toMatchObject({ state: 'running', attempt: 1 });
			const completed = harness.executions.completeNode(claim.id, claim.claimToken, node.nodeId, {
				text: `private-${node.nodeId}`
			});
			expect(completed).toMatchObject({
				state: 'succeeded',
				payload: { text: `private-${node.nodeId}` }
			});
		}
		const checkpoint = harness.database
			.prepare(
				`SELECT encrypted_payload FROM studio_flow_execution_node
				 WHERE execution_id = ? AND node_id = 'model1'`
			)
			.get(claim.id) as { encrypted_payload: string };
		expect(checkpoint.encrypted_payload).not.toContain('private-model1');

		harness.executions.finishSucceeded(claim.id, claim.claimToken, { text: 'private output' });
		const finished = harness.executions.get('user-a', claim.id)!;
		expect(finished).toMatchObject({
			state: 'succeeded',
			output: { text: 'private output' }
		});
		expect(
			harness.database
				.prepare(
					'SELECT claim_token_hash, claim_expires_at, heartbeat_at FROM studio_flow_execution WHERE id = ?'
				)
				.get(claim.id) as {
				claim_token_hash: string | null;
				claim_expires_at: number | null;
				heartbeat_at: number | null;
			}
		).toEqual({ claim_token_hash: null, claim_expires_at: null, heartbeat_at: 1_000 });
		expectExecutionError(
			() => harness.executions.finishSucceeded(claim.id, claim.claimToken, 'again'),
			'lost_claim'
		);

		const events = harness.executions.events('user-a', claim.id);
		expect(events.map((event) => event.sequence)).toEqual(
			Array.from({ length: events.length }, (_, index) => index + 1)
		);
		expect(events.at(-1)).toMatchObject({ state: 'succeeded', errorCode: null });
		expect(harness.executions.events('user-a', claim.id, events.length - 1)).toEqual([
			events.at(-1)
		]);
		expect(JSON.stringify(events)).not.toContain('private');
		harness.close();
	});

	it('fails one active node, cancels downstream nodes, and seals the terminal state', () => {
		const harness = createHarness();
		const flow = harness.createFlow('user-a');
		harness.queue('user-a', flow.id, 'failed-run');
		const claim = harness.executions.claimNext('worker-a')!;
		harness.executions.beginNode(claim.id, claim.claimToken, 'input1');
		harness.executions.finishFailed(claim.id, claim.claimToken, 'upstream_unavailable');

		const failed = harness.executions.get('user-a', claim.id)!;
		expect(failed).toMatchObject({ state: 'failed', errorCode: 'upstream_unavailable' });
		expect(failed.nodes[0]).toMatchObject({
			state: 'failed',
			errorCode: 'upstream_unavailable'
		});
		expect(failed.nodes.slice(1).every((node) => node.state === 'cancelled')).toBe(true);
		const events = harness.executions.events('user-a', claim.id);
		expect(events.at(-1)).toMatchObject({
			eventType: 'execution',
			state: 'failed',
			errorCode: 'upstream_unavailable'
		});
		expect(events.some((event) => event.nodeId === 'input1' && event.state === 'failed')).toBe(
			true
		);
		expectExecutionError(
			() => harness.executions.finishFailed(claim.id, claim.claimToken, 'internal_error'),
			'lost_claim'
		);
		harness.close();
	});

	it('cancels queued work immediately and lets a claimed worker acknowledge cancellation', () => {
		const harness = createHarness();
		const flow = harness.createFlow('user-a');
		const queued = harness.queue('user-a', flow.id, 'queued-cancel');
		expect(harness.executions.requestCancel('user-a', queued.id)).toMatchObject({
			state: 'cancelled',
			errorCode: 'cancelled'
		});
		expect(
			harness.executions.get('user-a', queued.id)?.nodes.every((node) => node.state === 'cancelled')
		).toBe(true);

		harness.queue('user-a', flow.id, 'running-cancel');
		const claim = harness.executions.claimNext('worker-a')!;
		const leases = new FlowCredentialLeaseStore({
			database: harness.database,
			encryptionKey: harness.encryptionKey,
			now: harness.now
		});
		leases.issue('user-a', claim.id, { owuiToken: 'private-token', owuiTokenExpiresAt: null });
		expect(harness.executions.requestCancel('user-a', claim.id).state).toBe('cancel_requested');
		expect(leases.acquire('user-a', claim.id)).toBeNull();
		expect(harness.executions.heartbeat(claim.id, claim.claimToken)).toEqual({
			cancelRequested: true
		});
		harness.executions.acknowledgeCancelled(claim.id, claim.claimToken);
		expect(harness.executions.get('user-a', claim.id)).toMatchObject({
			state: 'cancelled',
			errorCode: 'cancelled'
		});
		expectExecutionError(
			() => harness.executions.acknowledgeCancelled(claim.id, claim.claimToken),
			'lost_claim'
		);
		harness.close();
	});

	it('requeues stale deterministic work and preserves completed checkpoints', () => {
		const harness = createHarness({ claimTtlMs: 100 });
		const flow = harness.createFlow('user-a');
		harness.queue('user-a', flow.id, 'recover-input');
		const firstClaim = harness.executions.claimNext('worker-a')!;
		harness.executions.beginNode(firstClaim.id, firstClaim.claimToken, 'input1');
		harness.advance(101);

		expect(harness.executions.recoverStale()).toEqual({
			requeued: 1,
			failed: 0,
			cancelled: 0
		});
		const requeued = harness.executions.get('user-a', firstClaim.id)!;
		expect(requeued).toMatchObject({ state: 'queued' });
		expect(requeued.nodes[0]).toMatchObject({ state: 'pending', attempt: 1 });
		expectExecutionError(
			() => harness.executions.heartbeat(firstClaim.id, firstClaim.claimToken),
			'lost_claim'
		);
		const secondClaim = harness.executions.claimNext('worker-b')!;
		expect(secondClaim).toMatchObject({ id: firstClaim.id, claimAttempt: 2 });
		expect(
			harness.executions.beginNode(secondClaim.id, secondClaim.claimToken, 'input1').attempt
		).toBe(2);
		harness.close();
	});

	it('fails stale model work without redispatching an uncertain request', () => {
		const harness = createHarness({ claimTtlMs: 100 });
		const flow = harness.createFlow('user-a');
		harness.queue('user-a', flow.id, 'uncertain-model');
		const claim = harness.executions.claimNext('worker-a')!;
		harness.executions.beginNode(claim.id, claim.claimToken, 'input1');
		harness.executions.completeNode(claim.id, claim.claimToken, 'input1', { text: 'saved' });
		harness.executions.beginNode(claim.id, claim.claimToken, 'model1');
		harness.advance(101);

		expect(harness.executions.recoverStale()).toEqual({
			requeued: 0,
			failed: 1,
			cancelled: 0
		});
		const failed = harness.executions.get('user-a', claim.id)!;
		expect(failed).toMatchObject({ state: 'failed', errorCode: 'model_result_unknown' });
		expect(failed.nodes[0]).toMatchObject({ state: 'succeeded', payload: { text: 'saved' } });
		expect(failed.nodes[1]).toMatchObject({
			state: 'failed',
			errorCode: 'model_result_unknown'
		});
		expect(harness.executions.claimNext('worker-b')).toBeNull();
		harness.close();
	});

	it('settles stale cancellation and prevents later terminal changes', () => {
		const harness = createHarness({ claimTtlMs: 100 });
		const flow = harness.createFlow('user-a');
		harness.queue('user-a', flow.id, 'stale-cancel');
		const claim = harness.executions.claimNext('worker-a')!;
		harness.executions.requestCancel('user-a', claim.id);
		harness.advance(101);

		expect(harness.executions.recoverStale()).toEqual({
			requeued: 0,
			failed: 0,
			cancelled: 1
		});
		expect(harness.executions.get('user-a', claim.id)).toMatchObject({
			state: 'cancelled',
			errorCode: 'cancelled'
		});
		expect(harness.executions.requestCancel('user-a', claim.id).state).toBe('cancelled');
		expectExecutionError(
			() => harness.executions.finishFailed(claim.id, claim.claimToken, 'internal_error'),
			'lost_claim'
		);
		harness.close();
	});
});

function createHarness(options: { claimTtlMs?: number; maxConcurrent?: number } = {}) {
	let currentTime = 1_000;
	let flowNumber = 0;
	let executionNumber = 0;
	const now = () => currentTime;
	const database = openStudioDatabase(':memory:');
	const encryptionKey = randomBytes(32);
	const flows = new FlowStore(database, {
		now,
		nextId: () => `flow-${++flowNumber}`
	});
	const executions = new FlowExecutionStore({
		database,
		encryptionKey,
		now,
		nextId: () => `execution-${++executionNumber}`,
		claimTtlMs: options.claimTtlMs,
		maxConcurrent: options.maxConcurrent
	});
	return {
		database,
		encryptionKey,
		flows,
		executions,
		now,
		advance(milliseconds: number) {
			currentTime += milliseconds;
		},
		createFlow(owner: string) {
			return flows.create(owner, {
				name: `Flow ${flowNumber + 1}`,
				definition: validFlowDefinition()
			});
		},
		queue(owner: string, flowId: string, idempotencyKey: string) {
			return executions.create(owner, flowId, {
				idempotencyKey,
				inputs: { request: 'hello' }
			});
		},
		close() {
			database.close();
		}
	};
}

function executionCount(database: StudioDatabase): number {
	return (
		database.prepare('SELECT COUNT(*) AS count FROM studio_flow_execution').get() as {
			count: number;
		}
	).count;
}

function expectExecutionError(run: () => unknown, code: string, path?: string) {
	try {
		run();
		throw new Error('expected operation to fail');
	} catch (error) {
		expect(error).toBeInstanceOf(FlowExecutionError);
		expect(error).toMatchObject({ code, ...(path ? { path } : {}) });
	}
}
