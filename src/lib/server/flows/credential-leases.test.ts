import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openStudioDatabase, type StudioDatabase } from '$lib/server/database/database';
import { FlowCredentialLeaseError, FlowCredentialLeaseStore } from './credential-leases';
import { validFlowDefinition } from './fixtures';
import { FlowStore } from './store';

describe('FlowCredentialLeaseStore', () => {
	it('encrypts a short-lived credential and binds its expiry to the upstream token', () => {
		let now = 1_000;
		const { database, leases } = harness(() => now, 500);
		insertExecution(database, 'execution-a', 'user-a');

		expect(
			leases.issue('user-a', 'execution-a', {
				owuiToken: 'private-token',
				owuiTokenExpiresAt: 1_200
			})
		).toBe(1_200);
		const row = database
			.prepare(
				`SELECT owner_owui_user_id, encrypted_credential, expires_at
				 FROM studio_flow_credential_lease WHERE execution_id = 'execution-a'`
			)
			.get() as {
			owner_owui_user_id: string;
			encrypted_credential: string;
			expires_at: number;
		};
		expect(row).toMatchObject({ owner_owui_user_id: 'user-a', expires_at: 1_200 });
		expect(row.encrypted_credential).not.toContain('private-token');
		expect(leases.acquire('user-a', 'execution-a')).toEqual({
			owuiToken: 'private-token',
			owuiTokenExpiresAt: 1_200
		});

		now = 1_200;
		expect(leases.acquire('user-a', 'execution-a')).toBeNull();
		expect(rowCount(database)).toBe(0);
		database.close();
	});

	it('caps credentials without an upstream expiry at the configured lease TTL', () => {
		const { database, leases } = harness(() => 2_000, 300);
		insertExecution(database, 'execution-a', 'user-a');
		expect(
			leases.issue('user-a', 'execution-a', {
				owuiToken: 'private-token',
				owuiTokenExpiresAt: null
			})
		).toBe(2_300);
		database.close();
	});

	it('hides leases from other users and rejects cross-owner database rows', () => {
		const { database, leases } = harness();
		insertExecution(database, 'execution-a', 'user-a');
		leases.issue('user-a', 'execution-a', {
			owuiToken: 'private-token',
			owuiTokenExpiresAt: null
		});

		expect(leases.acquire('user-b', 'execution-a')).toBeNull();
		expect(leases.revoke('user-b', 'execution-a')).toBe(false);
		expect(leases.acquire('user-a', 'execution-a')?.owuiToken).toBe('private-token');
		expect(() =>
			database
				.prepare(
					`INSERT INTO studio_flow_credential_lease
					 (execution_id, owner_owui_user_id, encrypted_credential, expires_at, created_at)
					 VALUES ('execution-a', 'user-b', 'copied', 2000, 1000)`
				)
				.run()
		).toThrow();
		database.close();
	});

	it('cryptographically rejects ciphertext copied to another execution', () => {
		const { database, leases } = harness();
		insertExecution(database, 'execution-a', 'user-a');
		insertExecution(database, 'execution-b', 'user-a');
		for (const executionId of ['execution-a', 'execution-b'])
			leases.issue('user-a', executionId, {
				owuiToken: `token-${executionId}`,
				owuiTokenExpiresAt: null
			});
		const copied = database
			.prepare(
				`SELECT encrypted_credential FROM studio_flow_credential_lease
				 WHERE execution_id = 'execution-a'`
			)
			.get() as { encrypted_credential: string };
		database
			.prepare(
				`UPDATE studio_flow_credential_lease SET encrypted_credential = ?
				 WHERE execution_id = 'execution-b'`
			)
			.run(copied.encrypted_credential);

		expectLeaseError(() => leases.acquire('user-a', 'execution-b'), 'invalid_credential');
		expect(leases.acquire('user-a', 'execution-b')).toBeNull();
		expect(leases.acquire('user-a', 'execution-a')?.owuiToken).toBe('token-execution-a');
		database.close();
	});

	it('removes the lease in the same transaction as cancellation or terminal state', () => {
		for (const state of ['cancel_requested', 'succeeded', 'failed', 'cancelled'] as const) {
			const { database, leases } = harness();
			insertExecution(database, 'execution-a', 'user-a');
			leases.issue('user-a', 'execution-a', {
				owuiToken: 'private-token',
				owuiTokenExpiresAt: null
			});
			database
				.prepare("UPDATE studio_flow_execution SET state = ? WHERE id = 'execution-a'")
				.run(state);
			expect(rowCount(database)).toBe(0);
			expect(leases.acquire('user-a', 'execution-a')).toBeNull();
			database.close();
		}
	});

	it('will not issue leases for missing, cancelling, or terminal executions', () => {
		const { database, leases } = harness();
		const credential = { owuiToken: 'private-token', owuiTokenExpiresAt: null };
		expectLeaseError(() => leases.issue('user-a', 'missing', credential), 'not_found');

		for (const state of ['cancel_requested', 'succeeded', 'failed', 'cancelled'] as const) {
			insertExecution(database, `execution-${state}`, 'user-a', state);
			expectLeaseError(
				() => leases.issue('user-a', `execution-${state}`, credential),
				'inactive_execution'
			);
		}
		database.close();
	});

	it('rejects expired or empty credentials without persisting them', () => {
		const { database, leases } = harness(() => 1_000);
		insertExecution(database, 'execution-a', 'user-a');
		expectLeaseError(
			() =>
				leases.issue('user-a', 'execution-a', {
					owuiToken: 'private-token',
					owuiTokenExpiresAt: 1_000
				}),
			'expired_credential'
		);
		expectLeaseError(
			() => leases.issue('user-a', 'execution-a', { owuiToken: ' ', owuiTokenExpiresAt: null }),
			'invalid_credential'
		);
		expect(rowCount(database)).toBe(0);
		database.close();
	});

	it('deletes expired leases in a bounded sweep', () => {
		let now = 1_000;
		const { database, leases } = harness(() => now, 100);
		insertExecution(database, 'execution-a', 'user-a');
		insertExecution(database, 'execution-b', 'user-a');
		for (const executionId of ['execution-a', 'execution-b'])
			leases.issue('user-a', executionId, {
				owuiToken: `token-${executionId}`,
				owuiTokenExpiresAt: null
			});
		now = 1_100;
		expect(leases.deleteExpired()).toBe(2);
		expect(rowCount(database)).toBe(0);
		database.close();
	});
});

function harness(now: () => number = () => 1_000, leaseTtlMs = 500) {
	const database = openStudioDatabase(':memory:');
	const leases = new FlowCredentialLeaseStore({
		database,
		encryptionKey: randomBytes(32),
		now,
		leaseTtlMs
	});
	return { database, leases };
}

function insertExecution(
	database: StudioDatabase,
	executionId: string,
	ownerOwuiUserId: string,
	state: 'queued' | 'running' | 'cancel_requested' | 'succeeded' | 'failed' | 'cancelled' = 'queued'
) {
	const flowId = `flow-${executionId}`;
	let nextId = flowId;
	const flow = new FlowStore(database, { nextId: () => nextId }).create(ownerOwuiUserId, {
		name: `Flow ${executionId}`,
		definition: validFlowDefinition()
	});
	nextId = 'unused';
	database
		.prepare(
			`INSERT INTO studio_flow_execution
			 (id, flow_id, flow_version, owner_owui_user_id, state, idempotency_key, created_at, updated_at)
			 VALUES (?, ?, 1, ?, ?, ?, 1000, 1000)`
		)
		.run(executionId, flow.id, ownerOwuiUserId, state, `request-${executionId}`);
}

function rowCount(database: StudioDatabase): number {
	return (
		database.prepare('SELECT COUNT(*) AS count FROM studio_flow_credential_lease').get() as {
			count: number;
		}
	).count;
}

function expectLeaseError(run: () => unknown, code: string) {
	try {
		run();
		throw new Error('expected operation to fail');
	} catch (error) {
		expect(error).toBeInstanceOf(FlowCredentialLeaseError);
		expect(error).toMatchObject({ code });
	}
}
