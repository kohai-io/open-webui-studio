import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openStudioDatabase } from '$lib/server/database/database';
import { OwuiClient } from '$lib/server/owui/client';
import { createOwuiStub, stubClientOptions } from '$lib/server/owui/stub';
import type { StoredSession } from '$lib/server/sessions/store';
import { FlowExecutionStore } from './executions';
import { validFlowDefinition } from './fixtures';
import { loadFlowsPage } from './page';
import { FlowStore } from './store';

describe('loadFlowsPage', () => {
	it('returns the current owner data and authorised base models', async () => {
		const database = openStudioDatabase(':memory:');
		const flows = new FlowStore(database, {
			now: () => 1_000,
			nextId: (() => {
				let id = 0;
				return () => `flow-${++id}`;
			})()
		});
		const userA = flows.create('user-a', { name: 'A', definition: validFlowDefinition() });
		flows.create('user-b', { name: 'B', definition: validFlowDefinition() });
		const flowExecutions = new FlowExecutionStore({
			database,
			encryptionKey: randomBytes(32),
			now: () => 1_000,
			nextId: () => 'execution-1'
		});
		flowExecutions.create('user-a', userA.id, {
			idempotencyKey: 'request-1',
			inputs: { request: 'private' }
		});
		const stub = createOwuiStub();
		const client = new OwuiClient({ ...stubClientOptions(stub.fetch), token: 'private-token' });

		await expect(
			loadFlowsPage(locals(session()), undefined, {
				flows,
				flowExecutions,
				owuiForToken: () => client
			})
		).resolves.toMatchObject({
			authenticated: true,
			state: 'ready',
			flows: [{ id: userA.id }],
			executions: [{ id: 'execution-1' }],
			selectedFlow: { id: userA.id },
			models: [{ id: 'model-a', kind: 'model' }]
		});
		database.close();
	});

	it('returns a signed-out state without loading services', async () => {
		await expect(loadFlowsPage(locals(null))).resolves.toEqual({
			authenticated: false,
			state: 'authentication_required',
			flows: [],
			executions: [],
			selectedFlow: null,
			models: []
		});
	});
});

function session(): StoredSession {
	return {
		handle: 'handle-a',
		issuer: 'https://issuer.test',
		subject: 'subject-a',
		owuiUserId: 'user-a',
		owuiToken: 'private-token',
		owuiTokenExpiresAt: 10_000,
		expiresAt: 10_000,
		idleExpiresAt: 5_000
	};
}

function locals(current: StoredSession | null): App.Locals {
	return { requestId: 'request-a', session: current };
}
