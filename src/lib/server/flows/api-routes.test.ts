import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openStudioDatabase, type StudioDatabase } from '$lib/server/database/database';
import { FlowCredentialLeaseStore } from './credential-leases';
import { FlowExecutionStore } from './executions';
import { validFlowDefinition } from './fixtures';
import { FlowQueueService } from './queue';
import { FlowStore } from './store';
import type { StoredSession } from '$lib/server/sessions/store';

const mocked = vi.hoisted(() => ({ services: undefined as unknown }));
vi.mock('$lib/server/services', () => ({ getServices: () => mocked.services }));

import { GET as listFlows, POST as createFlow } from '../../../routes/api/flows/+server';
import {
	DELETE as deleteFlow,
	GET as getFlow,
	PUT as updateFlow
} from '../../../routes/api/flows/[id]/+server';
import { GET as getExecution } from '../../../routes/api/executions/[id]/+server';
import { POST as cancelExecution } from '../../../routes/api/executions/[id]/cancel/+server';
import { GET as executionEvents } from '../../../routes/api/executions/[id]/events/+server';
import {
	GET as listExecutions,
	POST as queueExecution
} from '../../../routes/api/flows/[id]/executions/+server';
import { GET as listVersions } from '../../../routes/api/flows/[id]/versions/+server';

let database: StudioDatabase | undefined;
afterEach(() => {
	database?.close();
	database = undefined;
});

describe('Flow API routes', () => {
	it('requires an authenticated Studio session before reading Flow data', async () => {
		const response = await listFlows(event({ session: null }));
		expect(response.status).toBe(401);
		await expect(response.json()).resolves.toEqual({ error: 'authentication_required' });
	});

	it('derives ownership from the session and hides cross-user executions', async () => {
		const harness = createServices();
		mocked.services = harness.services;
		const userA = session('user-a');
		const userB = session('user-b');

		const rejectedOwner = await createFlow(
			event({
				session: userA,
				method: 'POST',
				body: { name: 'Private', definition: validFlowDefinition(), owner: 'user-b' }
			})
		);
		expect(rejectedOwner.status).toBe(400);

		const crossOrigin = await createFlow(
			event({
				session: userA,
				method: 'POST',
				origin: 'https://attacker.test',
				body: { name: 'Private', definition: validFlowDefinition() }
			})
		);
		expect(crossOrigin.status).toBe(403);

		const createdResponse = await createFlow(
			event({
				session: userA,
				method: 'POST',
				body: { name: 'Private', definition: validFlowDefinition() }
			})
		);
		expect(createdResponse.status).toBe(201);
		const created = (await createdResponse.json()) as { id: string };

		const userBList = await listFlows(event({ session: userB }));
		await expect(userBList.json()).resolves.toEqual({ items: [] });
		const hiddenFlow = await getFlow(event({ session: userB, params: { id: created.id } }));
		expect(hiddenFlow.status).toBe(404);

		const updated = await updateFlow(
			event({
				session: userA,
				method: 'PUT',
				params: { id: created.id },
				body: { expectedRevision: 1, name: 'Renamed' }
			})
		);
		expect(updated.status).toBe(200);
		const staleUpdate = await updateFlow(
			event({
				session: userA,
				method: 'PUT',
				params: { id: created.id },
				body: { expectedRevision: 1, name: 'Stale' }
			})
		);
		expect(staleUpdate.status).toBe(409);
		const versions = await listVersions(event({ session: userA, params: { id: created.id } }));
		expect(((await versions.json()) as { items: unknown[] }).items).toHaveLength(2);

		const queuedResponse = await queueExecution(
			event({
				session: userA,
				method: 'POST',
				params: { id: created.id },
				headers: { 'idempotency-key': 'request-1' },
				body: { inputs: { request: 'private input' } }
			})
		);
		expect(queuedResponse.status).toBe(202);
		const queued = (await queuedResponse.json()) as { id: string };
		expect(harness.credentialLeases.has('user-a', queued.id)).toBe(true);

		const userBExecution = await getExecution(event({ session: userB, params: { id: queued.id } }));
		expect(userBExecution.status).toBe(404);
		const malformedExecution = await getExecution(event({ session: userA, params: { id: '' } }));
		expect(malformedExecution.status).toBe(400);
		const userBCancel = await cancelExecution(
			event({ session: userB, method: 'POST', params: { id: queued.id } })
		);
		expect(userBCancel.status).toBe(404);

		const listed = await listExecutions(event({ session: userA, params: { id: created.id } }));
		expect(((await listed.json()) as { items: unknown[] }).items).toHaveLength(1);
		const activeDelete = await deleteFlow(
			event({ session: userA, method: 'DELETE', params: { id: created.id } })
		);
		expect(activeDelete.status).toBe(409);

		const cancelled = await cancelExecution(
			event({ session: userA, method: 'POST', params: { id: queued.id } })
		);
		expect(cancelled.status).toBe(202);
		expect(harness.credentialLeases.has('user-a', queued.id)).toBe(false);

		const hiddenEvents = await executionEvents(
			event({ session: userB, params: { id: queued.id } })
		);
		expect(hiddenEvents.status).toBe(404);
		const events = await executionEvents(event({ session: userA, params: { id: queued.id } }));
		expect(events.headers.get('content-type')).toContain('text/event-stream');
		const eventBody = await events.text();
		expect(eventBody).toContain('"state":"cancelled"');
		expect(eventBody).not.toContain('private input');

		const deleted = await deleteFlow(
			event({ session: userA, method: 'DELETE', params: { id: created.id } })
		);
		expect(deleted.status).toBe(204);
		expect(harness.services.flows.get('user-a', created.id)).toBeNull();
	});
});

function createServices() {
	database = openStudioDatabase(':memory:');
	const encryptionKey = randomBytes(32);
	let flowId = 0;
	let executionId = 0;
	const flows = new FlowStore(database, {
		now: () => 1_000,
		nextId: () => `flow-${++flowId}`
	});
	const flowExecutions = new FlowExecutionStore({
		database,
		encryptionKey,
		now: () => 1_000,
		nextId: () => `execution-${++executionId}`
	});
	const credentialLeases = new FlowCredentialLeaseStore({
		database,
		encryptionKey,
		now: () => 1_000
	});
	const flowQueue = new FlowQueueService({
		database,
		executions: flowExecutions,
		credentialLeases,
		now: () => 1_000
	});
	return {
		credentialLeases,
		services: { flows, flowExecutions, flowQueue }
	};
}

function session(userId: string): StoredSession {
	return {
		handle: `handle-${userId}`,
		issuer: 'https://issuer.test',
		subject: `subject-${userId}`,
		owuiUserId: userId,
		owuiToken: `private-token-${userId}`,
		owuiTokenExpiresAt: 10_000,
		expiresAt: 10_000,
		idleExpiresAt: 5_000
	};
}

function event(options: {
	session: StoredSession | null;
	method?: string;
	params?: Record<string, string>;
	body?: unknown;
	headers?: Record<string, string>;
	origin?: string;
}) {
	const url = new URL('https://studio.test/studio/api/flows');
	const headers = new Headers(options.headers);
	if (options.method && options.method !== 'GET') {
		headers.set('content-type', 'application/json');
		headers.set('origin', options.origin ?? url.origin);
	}
	return {
		locals: { requestId: 'request-a', session: options.session },
		params: options.params ?? {},
		request: new Request(url, {
			method: options.method ?? 'GET',
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body)
		}),
		url
	} as never;
}
