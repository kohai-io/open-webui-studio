import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openStudioDatabase, type StudioDatabase } from '$lib/server/database/database';
import { validFlowDefinition } from './fixtures';
import { FlowStore, FlowStoreError } from './store';

describe('FlowStore', () => {
	it('applies the complete Flow migration to an empty database', () => {
		const database = openStudioDatabase(':memory:');
		const tables = database
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'studio_flow%'")
			.all() as Array<{ name: string }>;
		expect(tables.map((row) => row.name).sort()).toEqual([
			'studio_flow',
			'studio_flow_credential_lease',
			'studio_flow_event',
			'studio_flow_execution',
			'studio_flow_execution_node',
			'studio_flow_version'
		]);
		expect(database.pragma('foreign_keys', { simple: true })).toBe(1);
		expect(
			database
				.prepare("SELECT COUNT(*) AS count FROM studio_migration WHERE name = '0003_flows.sql'")
				.get()
		).toEqual({ count: 1 });
		database.close();
	});

	it('upgrades an existing Studio database without replacing foundation tables', () => {
		const directory = mkdtempSync(join(tmpdir(), 'studio-flow-migration-'));
		const filename = join(directory, 'studio.db');
		let upgraded: StudioDatabase | undefined;
		try {
			const existing = new Database(filename);
			existing.exec(
				'CREATE TABLE studio_migration (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)'
			);
			for (const name of ['0001_sessions.sql', '0002_oidc_transactions.sql']) {
				existing.exec(readFileSync(join(process.cwd(), 'migrations', name), 'utf8'));
				existing
					.prepare('INSERT INTO studio_migration (name, applied_at) VALUES (?, 1000)')
					.run(name);
			}
			existing.close();

			upgraded = openStudioDatabase(filename);
			const tables = upgraded
				.prepare(
					"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('studio_identity', 'studio_session', 'oidc_transaction', 'studio_flow') ORDER BY name"
				)
				.all();
			expect(tables).toEqual([
				{ name: 'oidc_transaction' },
				{ name: 'studio_flow' },
				{ name: 'studio_identity' },
				{ name: 'studio_session' }
			]);
			expect(
				upgraded
					.prepare("SELECT COUNT(*) AS count FROM studio_migration WHERE name = '0003_flows.sql'")
					.get()
			).toEqual({ count: 1 });
			expect(
				(upgraded.pragma('table_info(studio_flow_execution)') as Array<{ name: string }>).map(
					(column) => column.name
				)
			).toEqual(
				expect.arrayContaining([
					'claim_token_hash',
					'claim_attempt',
					'claim_expires_at',
					'claimed_by'
				])
			);
			expect(
				upgraded
					.prepare(
						"SELECT COUNT(*) AS count FROM studio_migration WHERE name = '0005_flow_execution_lifecycle.sql'"
					)
					.get()
			).toEqual({ count: 1 });
			expect(
				upgraded
					.prepare(
						"SELECT COUNT(*) AS count FROM studio_migration WHERE name = '0006_flow_worker_identity.sql'"
					)
					.get()
			).toEqual({ count: 1 });
		} finally {
			upgraded?.close();
			rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
		}
	});

	it('invalidates pre-contract credential leases during the ownership migration', () => {
		const directory = mkdtempSync(join(tmpdir(), 'studio-flow-lease-migration-'));
		const filename = join(directory, 'studio.db');
		let upgraded: StudioDatabase | undefined;
		try {
			const existing = new Database(filename);
			existing.pragma('foreign_keys = ON');
			existing.exec(
				'CREATE TABLE studio_migration (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)'
			);
			for (const name of ['0001_sessions.sql', '0002_oidc_transactions.sql', '0003_flows.sql']) {
				existing.exec(readFileSync(join(process.cwd(), 'migrations', name), 'utf8'));
				existing
					.prepare('INSERT INTO studio_migration (name, applied_at) VALUES (?, 1000)')
					.run(name);
			}
			existing.exec(`
				INSERT INTO studio_flow
				 (id, owner_owui_user_id, name, current_version, revision, created_at, updated_at)
				 VALUES ('flow-1', 'user-a', 'Migrating', 1, 1, 1000, 1000);
				INSERT INTO studio_flow_version
				 (flow_id, version, name, definition_json, definition_hash,
				  owner_owui_user_id, created_by_owui_user_id, created_at)
				 VALUES ('flow-1', 1, 'Migrating', '{}', 'hash', 'user-a', 'user-a', 1000);
				INSERT INTO studio_flow_execution
				 (id, flow_id, flow_version, owner_owui_user_id, state, idempotency_key,
				  created_at, updated_at)
				 VALUES ('execution-1', 'flow-1', 1, 'user-a', 'queued', 'request-1', 1000, 1000);
				INSERT INTO studio_flow_credential_lease
				 (execution_id, encrypted_credential, expires_at, created_at)
				 VALUES ('execution-1', 'pre-contract-ciphertext', 2000, 1000);
			`);
			existing.close();

			upgraded = openStudioDatabase(filename);
			expect(
				upgraded.prepare('SELECT COUNT(*) AS count FROM studio_flow_credential_lease').get()
			).toEqual({ count: 0 });
			expect(
				(
					upgraded.pragma('table_info(studio_flow_credential_lease)') as Array<{ name: string }>
				).map((column) => column.name)
			).toContain('owner_owui_user_id');
			expect(
				upgraded
					.prepare(
						"SELECT COUNT(*) AS count FROM studio_migration WHERE name = '0004_flow_credential_leases.sql'"
					)
					.get()
			).toEqual({ count: 1 });
			expect(
				upgraded
					.prepare("SELECT state, error_code FROM studio_flow_execution WHERE id = 'execution-1'")
					.get()
			).toEqual({ state: 'failed', error_code: 'internal_error' });
		} finally {
			upgraded?.close();
			rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
		}
	});

	it('creates, lists, and reads only the current owner flows', () => {
		const { database, store } = harness();
		const first = store.create('user-a', {
			name: '  First flow  ',
			description: 'A test flow',
			definition: validFlowDefinition()
		});
		const second = store.create('user-b', {
			name: 'Second flow',
			definition: validFlowDefinition()
		});

		expect(first).toMatchObject({
			id: 'flow-1',
			name: 'First flow',
			currentVersion: 1,
			revision: 1
		});
		expect(store.list('user-a')).toEqual([expect.objectContaining({ id: first.id })]);
		expect(store.list('user-b')).toEqual([expect.objectContaining({ id: second.id })]);
		expect(store.get('user-a', second.id)).toBeNull();
		expect(store.get('user-b', first.id)).toBeNull();
		database.close();
	});

	it('creates immutable versions and rolls back stale updates without gaps', () => {
		let now = 1_000;
		const { database, store } = harness(() => now);
		const created = store.create('user-a', {
			name: 'Versioned flow',
			definition: validFlowDefinition()
		});
		now = 2_000;
		const updated = store.update('user-a', created.id, {
			expectedRevision: 1,
			name: 'Renamed flow'
		});
		expect(updated).toMatchObject({ name: 'Renamed flow', currentVersion: 2, revision: 2 });
		expect(updated.definitionHash).toBe(created.definitionHash);
		expect(store.listVersions('user-a', created.id)).toMatchObject([
			{ version: 2, name: 'Renamed flow', createdAt: 2_000 },
			{ version: 1, name: 'Versioned flow', createdAt: 1_000 }
		]);

		expectStoreError(
			() => store.update('user-a', created.id, { expectedRevision: 1, name: 'Stale' }),
			'conflict'
		);
		expect(store.listVersions('user-a', created.id)).toHaveLength(2);
		database.close();
	});

	it('returns hidden not_found errors for cross-user mutations and history', () => {
		const { database, store } = harness();
		const flow = store.create('user-a', {
			name: 'Private flow',
			definition: validFlowDefinition()
		});
		expectStoreError(
			() => store.update('admin-b', flow.id, { expectedRevision: 1, name: 'Taken' }),
			'not_found'
		);
		expectStoreError(() => store.listVersions('admin-b', flow.id), 'not_found');
		expectStoreError(() => store.delete('admin-b', flow.id), 'not_found');
		expect(store.get('user-a', flow.id)?.name).toBe('Private flow');
		database.close();
	});

	it('enforces execution ownership at the database boundary', () => {
		const { database, store } = harness();
		const flow = store.create('user-a', {
			name: 'Owned flow',
			definition: validFlowDefinition()
		});
		expect(() =>
			database
				.prepare(
					`INSERT INTO studio_flow_execution
					 (id, flow_id, flow_version, owner_owui_user_id, state, idempotency_key, created_at, updated_at)
					 VALUES ('cross-owner', ?, 1, 'user-b', 'queued', 'request-b', 1000, 1000)`
				)
				.run(flow.id)
		).toThrow(/FOREIGN KEY constraint failed/);
		database.close();
	});

	it('persists no rows when metadata or definition validation fails', () => {
		const { database, store } = harness();
		expectStoreError(
			() => store.create('user-a', { name: ' ', definition: validFlowDefinition() }),
			'validation_failed'
		);
		const invalid = validFlowDefinition() as unknown as { nodes: Array<Record<string, unknown>> };
		invalid.nodes[1].type = 'websearch';
		expectStoreError(
			() => store.create('user-a', { name: 'Invalid', definition: invalid }),
			'validation_failed'
		);
		expect(database.prepare('SELECT COUNT(*) AS count FROM studio_flow').get()).toEqual({
			count: 0
		});
		database.close();
	});

	it('blocks deletion during active work and cascades all terminal execution data', () => {
		const { database, store } = harness();
		const flow = store.create('user-a', {
			name: 'Deletable flow',
			definition: validFlowDefinition()
		});
		insertExecutionGraph(database, flow.id, 'queued');
		expectStoreError(() => store.delete('user-a', flow.id), 'active_execution');
		database
			.prepare("UPDATE studio_flow_execution SET state = 'succeeded' WHERE id = 'execution-1'")
			.run();
		store.delete('user-a', flow.id);

		for (const table of [
			'studio_flow',
			'studio_flow_version',
			'studio_flow_execution',
			'studio_flow_execution_node',
			'studio_flow_credential_lease',
			'studio_flow_event'
		])
			expect(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({
				count: 0
			});
		database.close();
	});
});

function harness(now: () => number = () => 1_000) {
	const database = openStudioDatabase(':memory:');
	let id = 0;
	const store = new FlowStore(database, { now, nextId: () => `flow-${++id}` });
	return { database, store };
}

function expectStoreError(run: () => unknown, code: string) {
	try {
		run();
		throw new Error('expected operation to fail');
	} catch (error) {
		expect(error).toBeInstanceOf(FlowStoreError);
		expect(error).toMatchObject({ code });
	}
}

function insertExecutionGraph(
	database: StudioDatabase,
	flowId: string,
	state: 'queued' | 'succeeded'
) {
	database
		.prepare(
			`INSERT INTO studio_flow_execution
			 (id, flow_id, flow_version, owner_owui_user_id, state, idempotency_key, created_at, updated_at)
			 VALUES ('execution-1', ?, 1, 'user-a', ?, 'request-1', 1000, 1000)`
		)
		.run(flowId, state);
	database
		.prepare(
			`INSERT INTO studio_flow_execution_node
			 (execution_id, node_id, node_type, state, attempt)
			 VALUES ('execution-1', 'input1', 'input', 'succeeded', 1)`
		)
		.run();
	database
		.prepare(
			`INSERT INTO studio_flow_credential_lease
			 (execution_id, owner_owui_user_id, encrypted_credential, expires_at, created_at)
			 VALUES ('execution-1', 'user-a', 'encrypted', 2000, 1000)`
		)
		.run();
	database
		.prepare(
			`INSERT INTO studio_flow_event
			 (execution_id, sequence, owner_owui_user_id, event_type, state, created_at)
			 VALUES ('execution-1', 1, 'user-a', 'state', ?, 1000)`
		)
		.run(state);
}
