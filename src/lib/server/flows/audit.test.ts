import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openStudioDatabase } from '$lib/server/database/database';
import { FlowAuditStore } from './audit';
import { FlowExecutionStore } from './executions';
import { validFlowDefinition } from './fixtures';
import { FlowStore } from './store';

describe('FlowAuditStore', () => {
	it('stores only the fixed metadata schema and scopes reads to the owner', () => {
		const database = openStudioDatabase(':memory:');
		const flows = new FlowStore(database, { now: () => 1_000, nextId: () => 'flow-a' });
		const audit = new FlowAuditStore(database);
		flows.create('user-a', { name: 'Flow A', definition: validFlowDefinition() });

		expect(audit.list('user-a')).toEqual([
			expect.objectContaining({
				ownerOwuiUserId: 'user-a',
				action: 'flow_created',
				flowId: 'flow-a',
				flowVersion: 1,
				executionId: null,
				executionState: null,
				errorCode: null
			})
		]);
		expect(audit.list('user-b')).toEqual([]);
		expect(
			(database.prepare('PRAGMA table_info(studio_flow_audit)').all() as { name: string }[]).map(
				(column) => column.name
			)
		).toEqual([
			'id',
			'owner_owui_user_id',
			'action',
			'flow_id',
			'flow_version',
			'execution_id',
			'execution_state',
			'error_code',
			'created_at'
		]);
		database.close();
	});

	it('does not copy user content, definitions, runtime data, model IDs, or credentials', () => {
		const database = openStudioDatabase(':memory:');
		const definition = validFlowDefinition();
		definition.nodes[1] = {
			id: 'model1',
			type: 'model',
			position: { x: 240, y: 0 },
			config: {
				modelId: 'secret-model-marker',
				prompt: 'secret-prompt-marker {{node.input1.output}}'
			}
		};
		const flows = new FlowStore(database, { now: () => 1_000, nextId: () => 'flow-a' });
		flows.create('user-a', {
			name: 'secret-name-marker',
			description: 'secret-description-marker',
			definition
		});
		const executions = new FlowExecutionStore({
			database,
			encryptionKey: randomBytes(32),
			now: () => 1_001,
			nextId: () => 'execution-a'
		});
		executions.create('user-a', 'flow-a', {
			idempotencyKey: 'secret-idempotency-marker',
			inputs: { request: 'secret-input-marker' }
		});

		const encodedAudit = JSON.stringify(new FlowAuditStore(database).list('user-a'));
		for (const marker of [
			'secret-name-marker',
			'secret-description-marker',
			'secret-model-marker',
			'secret-prompt-marker',
			'secret-idempotency-marker',
			'secret-input-marker'
		])
			expect(encodedAudit).not.toContain(marker);
		database.close();
	});

	it('does not audit rejected or conflicting mutations', () => {
		const database = openStudioDatabase(':memory:');
		const flows = new FlowStore(database, { now: () => 1_000, nextId: () => 'flow-a' });
		const created = flows.create('user-a', { name: 'Flow A', definition: validFlowDefinition() });
		expect(() =>
			flows.update('user-a', created.id, { expectedRevision: 99, name: 'Rejected' })
		).toThrowError('conflict');
		expect(() =>
			flows.create('user-a', { name: '', definition: validFlowDefinition() })
		).toThrowError('validation_failed');

		expect(new FlowAuditStore(database).list('user-a').map((entry) => entry.action)).toEqual([
			'flow_created'
		]);
		database.close();
	});
});
