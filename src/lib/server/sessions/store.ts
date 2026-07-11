import { createHash, randomBytes } from 'node:crypto';
import type { StudioDatabase } from '$lib/server/database/database';
import { decryptJson, encryptJson } from './crypto';
import { normaliseEpochMilliseconds } from '$lib/server/time';

export interface SessionPayload {
	issuer: string;
	subject: string;
	owuiUserId: string;
	owuiToken: string;
	owuiTokenExpiresAt: number | null;
}

export interface StoredSession extends SessionPayload {
	handle: string;
	expiresAt: number;
	idleExpiresAt: number;
}

export interface SessionStoreOptions {
	database: StudioDatabase;
	encryptionKey: Buffer;
	now?: () => number;
	absoluteTtlMs?: number;
	idleTtlMs?: number;
}

export class SessionStore {
	private readonly now: () => number;
	private readonly absoluteTtlMs: number;
	private readonly idleTtlMs: number;

	constructor(private readonly options: SessionStoreOptions) {
		this.now = options.now ?? Date.now;
		this.absoluteTtlMs = options.absoluteTtlMs ?? 8 * 60 * 60 * 1000;
		this.idleTtlMs = options.idleTtlMs ?? 30 * 60 * 1000;
	}

	bindIdentity(issuer: string, subject: string, owuiUserId: string): void {
		const now = this.now();
		const existing = this.options.database
			.prepare('SELECT owui_user_id FROM studio_identity WHERE issuer = ? AND subject = ?')
			.get(issuer, subject) as { owui_user_id: string } | undefined;
		if (existing && existing.owui_user_id !== owuiUserId)
			throw new Error('OIDC subject binding mismatch');
		this.options.database
			.prepare(
				`INSERT INTO studio_identity (issuer, subject, owui_user_id, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(issuer, subject) DO UPDATE SET updated_at = excluded.updated_at`
			)
			.run(issuer, subject, owuiUserId, now, now);
	}

	create(payload: SessionPayload): StoredSession {
		this.bindIdentity(payload.issuer, payload.subject, payload.owuiUserId);
		const now = this.now();
		const normalisedPayload = {
			...payload,
			owuiTokenExpiresAt: normaliseEpochMilliseconds(payload.owuiTokenExpiresAt)
		};
		const handle = randomBytes(32).toString('base64url');
		const expiresAt = now + this.absoluteTtlMs;
		const idleExpiresAt = Math.min(expiresAt, now + this.idleTtlMs);
		this.options.database
			.prepare(
				`INSERT INTO studio_session
				 (id_hash, encrypted_payload, expires_at, idle_expires_at, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)`
			)
			.run(
				this.hash(handle),
				encryptJson(normalisedPayload, this.options.encryptionKey),
				expiresAt,
				idleExpiresAt,
				now,
				now
			);
		return { ...normalisedPayload, handle, expiresAt, idleExpiresAt };
	}

	get(handle: string): StoredSession | null {
		const row = this.options.database
			.prepare(
				'SELECT encrypted_payload, expires_at, idle_expires_at FROM studio_session WHERE id_hash = ?'
			)
			.get(this.hash(handle)) as
			{ encrypted_payload: string; expires_at: number; idle_expires_at: number } | undefined;
		if (!row) return null;
		const now = this.now();
		if (now >= row.expires_at || now >= row.idle_expires_at) {
			this.revoke(handle);
			return null;
		}
		const idleExpiresAt = Math.min(row.expires_at, now + this.idleTtlMs);
		this.options.database
			.prepare('UPDATE studio_session SET idle_expires_at = ?, updated_at = ? WHERE id_hash = ?')
			.run(idleExpiresAt, now, this.hash(handle));
		const payload = decryptJson<SessionPayload>(row.encrypted_payload, this.options.encryptionKey);
		return {
			...payload,
			owuiTokenExpiresAt: normaliseEpochMilliseconds(payload.owuiTokenExpiresAt),
			handle,
			expiresAt: row.expires_at,
			idleExpiresAt
		};
	}

	rotate(handle: string): StoredSession | null {
		const current = this.get(handle);
		if (!current) return null;
		this.revoke(handle);
		return this.create({
			issuer: current.issuer,
			subject: current.subject,
			owuiUserId: current.owuiUserId,
			owuiToken: current.owuiToken,
			owuiTokenExpiresAt: current.owuiTokenExpiresAt
		});
	}

	revoke(handle: string): void {
		this.options.database
			.prepare('DELETE FROM studio_session WHERE id_hash = ?')
			.run(this.hash(handle));
	}

	deleteExpired(): number {
		const now = this.now();
		return this.options.database
			.prepare('DELETE FROM studio_session WHERE expires_at <= ? OR idle_expires_at <= ?')
			.run(now, now).changes;
	}

	private hash(handle: string): string {
		return createHash('sha256').update(handle).digest('hex');
	}
}
