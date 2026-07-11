import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openStudioDatabase, type StudioDatabase } from '$lib/server/database/database';
import { OwuiClient } from '$lib/server/owui/client';
import type { OwuiTextCompletionRequest } from '$lib/server/owui/contracts';
import { OwuiError, type OwuiErrorCode } from '$lib/server/owui/errors';
import { createOwuiStub, stubClientOptions } from '$lib/server/owui/stub';
import { FlowCredentialLeaseStore } from './credential-leases';
import type { FlowDefinitionV1 } from './definition';
import { FlowExecutionStore } from './executions';
import { validFlowDefinition } from './fixtures';
import { FlowStore } from './store';
import { FlowWorker, type FlowCompletionClient } from './worker';

afterEach(() => vi.useRealTimers());

describe('FlowWorker', () => {
	it('executes the stored DAG once through the real adapter without creating a chat', async () => {
		const harness = createHarness();
		const execution = harness.queue(validFlowDefinition(), 'private request');
		harness.issueLease(execution.id);
		const stub = createOwuiStub();
		const worker = harness.worker(
			(token) => new OwuiClient({ ...stubClientOptions(stub.fetch), token })
		);

		await expect(worker.runOnce()).resolves.toEqual({
			status: 'succeeded',
			executionId: execution.id
		});
		const finished = harness.executions.get('user-a', execution.id)!;
		expect(finished).toMatchObject({ state: 'succeeded', output: 'Completed text' });
		expect(finished.nodes.every((node) => node.state === 'succeeded')).toBe(true);
		const completionRequests = stub.requests.filter(
			(request) => new URL(request.url).pathname === '/api/chat/completions'
		);
		expect(completionRequests).toHaveLength(1);
		expect(
			stub.requests.some((request) => new URL(request.url).pathname.includes('/chats/new'))
		).toBe(false);
		expect(await completionRequests[0].json()).toMatchObject({
			model: 'model-a',
			messages: [{ role: 'user', content: 'Summarise private request' }],
			stream: true
		});
		expect(leaseCount(harness.database)).toBe(0);
		expect(JSON.stringify(harness.executions.events('user-a', execution.id))).not.toContain(
			'private request'
		);
		harness.close();
	});

	it('runs deterministic transform-only flows without acquiring an OWUI credential', async () => {
		const harness = createHarness();
		const execution = harness.queue(transformOnlyDefinition(), '  hello  ');
		const worker = harness.worker(() => {
			throw new Error('OWUI client must not be created');
		});

		await expect(worker.runOnce()).resolves.toEqual({
			status: 'succeeded',
			executionId: execution.id
		});
		expect(harness.executions.get('user-a', execution.id)).toMatchObject({
			state: 'succeeded',
			output: 'HELLO'
		});
		harness.close();
	});

	it('fails closed before dispatch when the Model credential lease is missing', async () => {
		const harness = createHarness();
		const execution = harness.queue(validFlowDefinition(), 'hello');
		const completeText = vi.fn();
		const worker = harness.worker(() => ({ completeText }));

		await expect(worker.runOnce()).resolves.toEqual({
			status: 'failed',
			executionId: execution.id,
			errorCode: 'authentication_required'
		});
		expect(completeText).not.toHaveBeenCalled();
		const failed = harness.executions.get('user-a', execution.id)!;
		expect(failed).toMatchObject({ state: 'failed', errorCode: 'authentication_required' });
		expect(failed.nodes[1]).toMatchObject({
			state: 'failed',
			errorCode: 'authentication_required'
		});
		harness.close();
	});

	it.each<[OwuiErrorCode, string]>([
		['not_found', 'dependency_not_found'],
		['permission_denied', 'dependency_not_found'],
		['rate_limited', 'rate_limited'],
		['upstream_unavailable', 'upstream_unavailable']
	])('maps OWUI %s without retrying the Model dispatch', async (owuiCode, expectedCode) => {
		const harness = createHarness();
		const execution = harness.queue(validFlowDefinition(), 'hello');
		harness.issueLease(execution.id);
		const completeText = vi.fn().mockRejectedValue(new OwuiError(owuiCode, 503, 'request-a'));
		const worker = harness.worker(() => ({ completeText }));

		await expect(worker.runOnce()).resolves.toEqual({
			status: 'failed',
			executionId: execution.id,
			errorCode: expectedCode
		});
		expect(completeText).toHaveBeenCalledTimes(1);
		harness.close();
	});

	it('refreshes heartbeats during a long Model call and retains the last heartbeat', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const harness = createHarness();
		const execution = harness.queue(validFlowDefinition(), 'hello');
		harness.issueLease(execution.id);
		const deferred = deferredCompletion();
		const worker = harness.worker(() => ({ completeText: deferred.completeText }), {
			heartbeatIntervalMs: 50,
			nodeTimeoutMs: 1_000,
			runTimeoutMs: 2_000
		});
		const running = worker.runOnce();
		await vi.advanceTimersByTimeAsync(150);
		expect(deferred.completeText).toHaveBeenCalledTimes(1);
		deferred.resolve('slow response');
		await expect(running).resolves.toEqual({ status: 'succeeded', executionId: execution.id });
		expect(
			harness.database
				.prepare('SELECT heartbeat_at FROM studio_flow_execution WHERE id = ?')
				.get(execution.id)
		).toEqual({ heartbeat_at: 1_150 });
		harness.close();
	});

	it('aborts an active Model call and acknowledges owner cancellation', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const harness = createHarness();
		const execution = harness.queue(validFlowDefinition(), 'hello');
		harness.issueLease(execution.id);
		const deferred = deferredCompletion();
		const worker = harness.worker(() => ({ completeText: deferred.completeText }), {
			heartbeatIntervalMs: 50,
			nodeTimeoutMs: 1_000,
			runTimeoutMs: 2_000
		});
		const running = worker.runOnce();
		await vi.advanceTimersByTimeAsync(0);
		expect(deferred.completeText).toHaveBeenCalledTimes(1);
		harness.executions.requestCancel('user-a', execution.id);
		await vi.advanceTimersByTimeAsync(50);

		await expect(running).resolves.toEqual({ status: 'cancelled', executionId: execution.id });
		expect(deferred.signal?.aborted).toBe(true);
		expect(harness.executions.get('user-a', execution.id)).toMatchObject({
			state: 'cancelled',
			errorCode: 'cancelled'
		});
		expect(leaseCount(harness.database)).toBe(0);
		harness.close();
	});

	it('enforces the Model node deadline and dispatches only once', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const harness = createHarness();
		const execution = harness.queue(validFlowDefinition(), 'hello');
		harness.issueLease(execution.id);
		const deferred = deferredCompletion();
		const worker = harness.worker(() => ({ completeText: deferred.completeText }), {
			heartbeatIntervalMs: 50,
			nodeTimeoutMs: 100,
			runTimeoutMs: 1_000
		});
		const running = worker.runOnce();
		await vi.advanceTimersByTimeAsync(101);

		await expect(running).resolves.toEqual({
			status: 'failed',
			executionId: execution.id,
			errorCode: 'timeout'
		});
		expect(deferred.completeText).toHaveBeenCalledTimes(1);
		expect(deferred.signal?.aborted).toBe(true);
		expect(harness.executions.get('user-a', execution.id)).toMatchObject({
			state: 'failed',
			errorCode: 'timeout'
		});
		harness.close();
	});

	it('enforces the whole-run deadline independently of the node deadline', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const harness = createHarness();
		const execution = harness.queue(validFlowDefinition(), 'hello');
		harness.issueLease(execution.id);
		const deferred = deferredCompletion();
		const worker = harness.worker(() => ({ completeText: deferred.completeText }), {
			heartbeatIntervalMs: 25,
			nodeTimeoutMs: 1_000,
			runTimeoutMs: 100
		});
		const running = worker.runOnce();
		await vi.advanceTimersByTimeAsync(101);

		await expect(running).resolves.toEqual({
			status: 'failed',
			executionId: execution.id,
			errorCode: 'timeout'
		});
		expect(deferred.completeText).toHaveBeenCalledTimes(1);
		harness.close();
	});

	it('converts an unexpected background heartbeat failure into a sealed run failure', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const harness = createHarness();
		const execution = harness.queue(validFlowDefinition(), 'hello');
		harness.issueLease(execution.id);
		const deferred = deferredCompletion();
		const heartbeat = harness.executions.heartbeat.bind(harness.executions);
		let heartbeatCalls = 0;
		vi.spyOn(harness.executions, 'heartbeat').mockImplementation((executionId, claimToken) => {
			heartbeatCalls++;
			if (heartbeatCalls === 5) throw new Error('database heartbeat failure');
			return heartbeat(executionId, claimToken);
		});
		const worker = harness.worker(() => ({ completeText: deferred.completeText }), {
			heartbeatIntervalMs: 50,
			nodeTimeoutMs: 1_000,
			runTimeoutMs: 2_000
		});
		const running = worker.runOnce();
		await vi.advanceTimersByTimeAsync(50);

		await expect(running).resolves.toEqual({
			status: 'failed',
			executionId: execution.id,
			errorCode: 'internal_error'
		});
		expect(harness.executions.get('user-a', execution.id)).toMatchObject({
			state: 'failed',
			errorCode: 'internal_error'
		});
		harness.close();
	});

	it('resumes completed checkpoints and does not repeat the Input node', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const harness = createHarness({ claimTtlMs: 100 });
		const execution = harness.queue(validFlowDefinition(), 'saved input');
		harness.issueLease(execution.id);
		const abandoned = harness.executions.claimNext('abandoned-worker')!;
		harness.executions.beginNode(abandoned.id, abandoned.claimToken, 'input1');
		harness.executions.completeNode(abandoned.id, abandoned.claimToken, 'input1', 'saved input');
		vi.setSystemTime(1_101);
		const completeText = vi.fn(async () => ({
			modelId: 'model-a',
			content: 'resumed',
			requestId: 'request-a'
		}));
		const worker = harness.worker(() => ({ completeText }), { heartbeatIntervalMs: 25 });

		await expect(worker.runOnce()).resolves.toEqual({
			status: 'succeeded',
			executionId: execution.id
		});
		const finished = harness.executions.get('user-a', execution.id)!;
		expect(finished.nodes[0]).toMatchObject({ state: 'succeeded', attempt: 1 });
		expect(finished.nodes[1]).toMatchObject({ state: 'succeeded', attempt: 1 });
		expect(completeText).toHaveBeenCalledTimes(1);
		harness.close();
	});

	it('fails an abandoned in-flight Model call without redispatching it', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const harness = createHarness({ claimTtlMs: 100 });
		const execution = harness.queue(validFlowDefinition(), 'hello');
		harness.issueLease(execution.id);
		const abandoned = harness.executions.claimNext('abandoned-worker')!;
		harness.executions.beginNode(abandoned.id, abandoned.claimToken, 'input1');
		harness.executions.completeNode(abandoned.id, abandoned.claimToken, 'input1', 'hello');
		harness.executions.beginNode(abandoned.id, abandoned.claimToken, 'model1');
		vi.setSystemTime(1_101);
		const completeText = vi.fn();
		const worker = harness.worker(() => ({ completeText }), { heartbeatIntervalMs: 25 });

		await expect(worker.runOnce()).resolves.toEqual({ status: 'idle' });
		expect(completeText).not.toHaveBeenCalled();
		expect(harness.executions.get('user-a', execution.id)).toMatchObject({
			state: 'failed',
			errorCode: 'model_result_unknown'
		});
		expect(leaseCount(harness.database)).toBe(0);
		harness.close();
	});
});

function createHarness(options: { claimTtlMs?: number } = {}) {
	let flowNumber = 0;
	let executionNumber = 0;
	const database = openStudioDatabase(':memory:');
	const encryptionKey = randomBytes(32);
	const flows = new FlowStore(database, {
		now: Date.now,
		nextId: () => `flow-${++flowNumber}`
	});
	const executions = new FlowExecutionStore({
		database,
		encryptionKey,
		now: Date.now,
		nextId: () => `execution-${++executionNumber}`,
		claimTtlMs: options.claimTtlMs
	});
	const credentialLeases = new FlowCredentialLeaseStore({
		database,
		encryptionKey,
		now: Date.now
	});
	return {
		database,
		executions,
		queue(definition: FlowDefinitionV1, request: string) {
			const flow = flows.create('user-a', {
				name: `Flow ${flowNumber + 1}`,
				definition
			});
			return executions.create('user-a', flow.id, {
				idempotencyKey: `request-${executionNumber + 1}`,
				inputs: { request }
			});
		},
		issueLease(executionId: string) {
			return credentialLeases.issue('user-a', executionId, {
				owuiToken: 'private-token',
				owuiTokenExpiresAt: null
			});
		},
		worker(
			clientForToken: (token: string) => FlowCompletionClient,
			workerOptions: {
				heartbeatIntervalMs?: number;
				nodeTimeoutMs?: number;
				runTimeoutMs?: number;
			} = {}
		) {
			return new FlowWorker({
				workerId: 'worker-a',
				executions,
				credentialLeases,
				clientForToken,
				...workerOptions
			});
		},
		close() {
			database.close();
		}
	};
}

function transformOnlyDefinition(): FlowDefinitionV1 {
	return {
		schemaVersion: 1,
		nodes: [
			{ id: 'input1', type: 'input', position: { x: 0, y: 0 }, config: { key: 'request' } },
			{
				id: 'trim1',
				type: 'transform',
				position: { x: 200, y: 0 },
				config: { operation: 'trim' }
			},
			{
				id: 'upper1',
				type: 'transform',
				position: { x: 400, y: 0 },
				config: { operation: 'uppercase' }
			},
			{
				id: 'output1',
				type: 'output',
				position: { x: 600, y: 0 },
				config: { format: 'text' }
			}
		],
		edges: [
			{ id: 'edge1', source: 'input1', target: 'trim1' },
			{ id: 'edge2', source: 'trim1', target: 'upper1' },
			{ id: 'edge3', source: 'upper1', target: 'output1' }
		]
	};
}

function deferredCompletion() {
	let resolvePromise!: (value: { modelId: string; content: string; requestId: string }) => void;
	let rejectPromise!: (reason: unknown) => void;
	const completeText = vi.fn((input: OwuiTextCompletionRequest) => {
		state.signal = input.signal;
		return new Promise<{ modelId: string; content: string; requestId: string }>(
			(resolve, reject) => {
				resolvePromise = resolve;
				rejectPromise = reject;
				input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
			}
		);
	});
	const state: { signal?: AbortSignal } = {};
	return {
		completeText,
		get signal() {
			return state.signal;
		},
		resolve(content: string) {
			resolvePromise({ modelId: 'model-a', content, requestId: 'request-a' });
		},
		reject(error: unknown) {
			rejectPromise(error);
		}
	};
}

function leaseCount(database: StudioDatabase): number {
	return (
		database.prepare('SELECT COUNT(*) AS count FROM studio_flow_credential_lease').get() as {
			count: number;
		}
	).count;
}
