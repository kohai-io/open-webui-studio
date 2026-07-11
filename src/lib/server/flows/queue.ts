import type { StudioDatabase } from '$lib/server/database/database';
import type { StoredSession } from '$lib/server/sessions/store';
import { FlowCredentialLeaseError, type FlowCredentialLeaseStore } from './credential-leases';
import {
	FlowExecutionError,
	type FlowExecutionCreateInput,
	type FlowExecutionRecord,
	type FlowExecutionStore
} from './executions';

export class FlowQueueError extends Error {
	constructor(readonly code: 'authentication_required' | 'not_found' | 'validation_failed') {
		super(code);
		this.name = 'FlowQueueError';
	}
}

export interface FlowQueueServiceOptions {
	database: StudioDatabase;
	executions: FlowExecutionStore;
	credentialLeases: FlowCredentialLeaseStore;
	now?: () => number;
	onQueued?: () => void;
}

export class FlowQueueService {
	private readonly now: () => number;

	constructor(private readonly options: FlowQueueServiceOptions) {
		this.now = options.now ?? Date.now;
	}

	enqueue(
		session: StoredSession,
		flowId: string,
		input: FlowExecutionCreateInput
	): FlowExecutionRecord {
		const now = this.now();
		const credentialExpiresAt = Math.min(
			session.expiresAt,
			session.idleExpiresAt,
			session.owuiTokenExpiresAt ?? Number.MAX_SAFE_INTEGER
		);
		if (credentialExpiresAt <= now) throw new FlowQueueError('authentication_required');

		let execution: FlowExecutionRecord | undefined;
		try {
			execution = this.options.database
				.transaction(() => {
					const queued = this.options.executions.create(session.owuiUserId, flowId, input);
					if (
						queued.state === 'queued' &&
						!this.options.credentialLeases.has(session.owuiUserId, queued.id)
					)
						this.options.credentialLeases.issue(session.owuiUserId, queued.id, {
							owuiToken: session.owuiToken,
							owuiTokenExpiresAt: credentialExpiresAt
						});
					return queued;
				})
				.immediate();
		} catch (error) {
			if (error instanceof FlowQueueError) throw error;
			if (error instanceof FlowExecutionError) {
				if (error.code === 'not_found') throw new FlowQueueError('not_found');
				if (error.code === 'validation_failed') throw new FlowQueueError('validation_failed');
			}
			if (error instanceof FlowCredentialLeaseError)
				throw new FlowQueueError(
					error.code === 'not_found' ? 'not_found' : 'authentication_required'
				);
			throw error;
		}
		if (execution.state === 'queued') this.options.onQueued?.();
		return execution;
	}
}
