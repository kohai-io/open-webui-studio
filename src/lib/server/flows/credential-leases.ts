import type { StudioDatabase } from '$lib/server/database/database';
import { decryptJson, encryptJson } from '$lib/server/sessions/crypto';

const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;

export interface FlowCredential {
	owuiToken: string;
	owuiTokenExpiresAt: number | null;
}

export type FlowCredentialLeaseErrorCode =
	'not_found' | 'inactive_execution' | 'expired_credential' | 'invalid_credential';

export class FlowCredentialLeaseError extends Error {
	constructor(readonly code: FlowCredentialLeaseErrorCode) {
		super(code);
		this.name = 'FlowCredentialLeaseError';
	}
}

export interface FlowCredentialLeaseStoreOptions {
	database: StudioDatabase;
	encryptionKey: Buffer;
	now?: () => number;
	leaseTtlMs?: number;
}

interface ExecutionRow {
	state: string;
}

interface LeaseRow {
	encrypted_credential: string;
	expires_at: number;
}

export class FlowCredentialLeaseStore {
	private readonly now: () => number;
	private readonly leaseTtlMs: number;

	constructor(private readonly options: FlowCredentialLeaseStoreOptions) {
		if (options.encryptionKey.length !== 32) throw new Error('encryptionKey must be 32 bytes');
		this.now = options.now ?? Date.now;
		this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
		if (!Number.isSafeInteger(this.leaseTtlMs) || this.leaseTtlMs <= 0)
			throw new Error('leaseTtlMs must be a positive integer');
	}

	issue(ownerOwuiUserId: string, executionId: string, credential: FlowCredential): number {
		this.validateIdentity(ownerOwuiUserId, executionId);
		if (!credential.owuiToken.trim()) throw new FlowCredentialLeaseError('invalid_credential');
		const now = this.now();
		if (
			credential.owuiTokenExpiresAt !== null &&
			(!Number.isSafeInteger(credential.owuiTokenExpiresAt) || credential.owuiTokenExpiresAt <= now)
		)
			throw new FlowCredentialLeaseError('expired_credential');

		const execution = this.findExecution(ownerOwuiUserId, executionId);
		if (!execution) throw new FlowCredentialLeaseError('not_found');
		if (execution.state !== 'queued' && execution.state !== 'running')
			throw new FlowCredentialLeaseError('inactive_execution');

		const expiresAt = Math.min(
			now + this.leaseTtlMs,
			credential.owuiTokenExpiresAt ?? Number.MAX_SAFE_INTEGER
		);
		const encrypted = encryptJson(
			credential,
			this.options.encryptionKey,
			this.associatedData(ownerOwuiUserId, executionId)
		);
		this.options.database
			.prepare(
				`INSERT INTO studio_flow_credential_lease
				 (execution_id, owner_owui_user_id, encrypted_credential, expires_at, created_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(execution_id) DO UPDATE SET
				   owner_owui_user_id = excluded.owner_owui_user_id,
				   encrypted_credential = excluded.encrypted_credential,
				   expires_at = excluded.expires_at,
				   created_at = excluded.created_at`
			)
			.run(executionId, ownerOwuiUserId, encrypted, expiresAt, now);
		return expiresAt;
	}

	acquire(ownerOwuiUserId: string, executionId: string): FlowCredential | null {
		this.validateIdentity(ownerOwuiUserId, executionId);
		const execution = this.findExecution(ownerOwuiUserId, executionId);
		if (!execution || (execution.state !== 'queued' && execution.state !== 'running')) {
			this.revoke(ownerOwuiUserId, executionId);
			return null;
		}
		const row = this.options.database
			.prepare(
				`SELECT encrypted_credential, expires_at
				 FROM studio_flow_credential_lease
				 WHERE execution_id = ? AND owner_owui_user_id = ?`
			)
			.get(executionId, ownerOwuiUserId) as LeaseRow | undefined;
		if (!row) return null;
		if (this.now() >= row.expires_at) {
			this.revoke(ownerOwuiUserId, executionId);
			return null;
		}
		try {
			const credential = decryptJson<FlowCredential>(
				row.encrypted_credential,
				this.options.encryptionKey,
				this.associatedData(ownerOwuiUserId, executionId)
			);
			if (!credential.owuiToken?.trim()) throw new Error('invalid credential');
			return credential;
		} catch {
			this.revoke(ownerOwuiUserId, executionId);
			throw new FlowCredentialLeaseError('invalid_credential');
		}
	}

	revoke(ownerOwuiUserId: string, executionId: string): boolean {
		return (
			this.options.database
				.prepare(
					`DELETE FROM studio_flow_credential_lease
					 WHERE execution_id = ? AND owner_owui_user_id = ?`
				)
				.run(executionId, ownerOwuiUserId).changes === 1
		);
	}

	has(ownerOwuiUserId: string, executionId: string): boolean {
		this.validateIdentity(ownerOwuiUserId, executionId);
		return Boolean(
			this.options.database
				.prepare(
					`SELECT 1 FROM studio_flow_credential_lease
					 WHERE execution_id = ? AND owner_owui_user_id = ? AND expires_at > ?`
				)
				.get(executionId, ownerOwuiUserId, this.now())
		);
	}

	deleteExpired(): number {
		return this.options.database
			.prepare('DELETE FROM studio_flow_credential_lease WHERE expires_at <= ?')
			.run(this.now()).changes;
	}

	private findExecution(ownerOwuiUserId: string, executionId: string): ExecutionRow | undefined {
		return this.options.database
			.prepare(
				`SELECT state FROM studio_flow_execution
				 WHERE id = ? AND owner_owui_user_id = ?`
			)
			.get(executionId, ownerOwuiUserId) as ExecutionRow | undefined;
	}

	private validateIdentity(ownerOwuiUserId: string, executionId: string): void {
		if (!ownerOwuiUserId.trim() || !executionId.trim())
			throw new FlowCredentialLeaseError('not_found');
	}

	private associatedData(ownerOwuiUserId: string, executionId: string): string {
		return `studio-flow-credential-lease:v1:${ownerOwuiUserId}:${executionId}`;
	}
}
