import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { openStudioDatabase } from '$lib/server/database/database';
import type { OwuiTextCompletionRequest } from '$lib/server/owui/contracts';
import { FlowAuditStore } from './audit';
import { FlowCredentialLeaseStore } from './credential-leases';
import { FlowExecutionStore } from './executions';
import { validFlowDefinition } from './fixtures';
import { FlowStore } from './store';
import { FlowWorker } from './worker';

describe('representative Flow lifecycle', () => {
	it('isolates two users, pins execution versions, audits terminal work, and retains delete history', async () => {
		let now = 1_000;
		let flowNumber = 0;
		let executionNumber = 0;
		const database = openStudioDatabase(':memory:');
		const encryptionKey = randomBytes(32);
		const flows = new FlowStore(database, {
			now: () => now,
			nextId: () => `flow-${++flowNumber}`
		});
		const executions = new FlowExecutionStore({
			database,
			encryptionKey,
			now: () => now,
			nextId: () => `execution-${++executionNumber}`
		});
		const credentialLeases = new FlowCredentialLeaseStore({
			database,
			encryptionKey,
			now: () => now
		});
		const audit = new FlowAuditStore(database);

		const definitionV1 = validFlowDefinition();
		const userAFlow = flows.create('user-a', {
			name: 'private-name-a',
			description: 'private-description-a',
			definition: definitionV1
		});
		const userBFlow = flows.create('user-b', {
			name: 'Flow B',
			definition: validFlowDefinition()
		});
		const userAExecution = executions.create('user-a', userAFlow.id, {
			idempotencyKey: 'private-key-a',
			inputs: { request: 'private-input-a' }
		});
		credentialLeases.issue('user-a', userAExecution.id, {
			owuiToken: 'private-token-a',
			owuiTokenExpiresAt: null
		});

		now++;
		const definitionV2 = validFlowDefinition();
		const modelV2 = definitionV2.nodes.find((node) => node.type === 'model');
		if (!modelV2 || modelV2.type !== 'model') throw new Error('missing model fixture');
		modelV2.config.prompt = 'Changed v2 {{node.input1.output}}';
		flows.update('user-a', userAFlow.id, {
			expectedRevision: userAFlow.revision,
			definition: definitionV2
		});

		const completeText = vi.fn(async (request: OwuiTextCompletionRequest) => ({
			modelId: request.modelId,
			content: 'private-output-a',
			requestId: 'private-request-id-a'
		}));
		const worker = new FlowWorker({
			workerId: 'worker-a',
			executions,
			credentialLeases,
			clientForToken: (token) => {
				expect(token).toBe('private-token-a');
				return { completeText };
			}
		});
		await expect(worker.runOnce()).resolves.toEqual({
			status: 'succeeded',
			executionId: userAExecution.id
		});
		expect(completeText).toHaveBeenCalledWith(
			expect.objectContaining({ prompt: 'Summarise private-input-a' })
		);
		expect(executions.get('user-a', userAExecution.id)).toMatchObject({
			flowVersion: 1,
			state: 'succeeded',
			output: 'private-output-a'
		});

		expect(flows.get('user-b', userAFlow.id)).toBeNull();
		expect(executions.get('user-b', userAExecution.id)).toBeNull();
		expect(() => executions.events('user-b', userAExecution.id)).toThrowError('not_found');
		expect(audit.list('user-b').some((entry) => entry.flowId === userAFlow.id)).toBe(false);

		now++;
		const userBExecution = executions.create('user-b', userBFlow.id, {
			idempotencyKey: 'request-b',
			inputs: { request: 'private-input-b' }
		});
		expect(executions.requestCancel('user-b', userBExecution.id)).toMatchObject({
			state: 'cancelled',
			errorCode: 'cancelled'
		});
		expect(executions.get('user-a', userBExecution.id)).toBeNull();

		now++;
		flows.delete('user-a', userAFlow.id);
		expect(flows.get('user-a', userAFlow.id)).toBeNull();
		expect(audit.list('user-a').map((entry) => entry.action)).toEqual([
			'flow_created',
			'execution_queued',
			'flow_updated',
			'execution_started',
			'execution_succeeded',
			'flow_deleted'
		]);
		expect(audit.list('user-b').map((entry) => entry.action)).toEqual([
			'flow_created',
			'execution_queued',
			'execution_cancelled'
		]);

		const encodedAudit = JSON.stringify([...audit.list('user-a'), ...audit.list('user-b')]);
		for (const marker of [
			'private-name-a',
			'private-description-a',
			'private-key-a',
			'private-input-a',
			'private-token-a',
			'private-output-a',
			'private-request-id-a',
			'private-input-b'
		])
			expect(encodedAudit).not.toContain(marker);
		database.close();
	});
});
