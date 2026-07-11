import { createHash, randomBytes } from 'node:crypto';
import type { StudioDatabase } from '$lib/server/database/database';
import { decryptJson, encryptJson } from '$lib/server/sessions/crypto';
import type { OidcTransaction } from './provider';

export class OidcTransactionStore {
	constructor(
		private readonly database: StudioDatabase,
		private readonly key: Buffer,
		private readonly now: () => number = Date.now
	) {}
	create(payload: OidcTransaction, ttlMs = 5 * 60 * 1000): string {
		const handle = randomBytes(32).toString('base64url');
		const now = this.now();
		this.database
			.prepare(
				'INSERT INTO oidc_transaction (id_hash, encrypted_payload, expires_at, created_at) VALUES (?, ?, ?, ?)'
			)
			.run(this.hash(handle), encryptJson(payload, this.key), now + ttlMs, now);
		return handle;
	}
	consume(handle: string): OidcTransaction | null {
		const hash = this.hash(handle);
		const transaction = this.database.transaction(() => {
			const row = this.database
				.prepare('SELECT encrypted_payload, expires_at FROM oidc_transaction WHERE id_hash = ?')
				.get(hash) as { encrypted_payload: string; expires_at: number } | undefined;
			this.database.prepare('DELETE FROM oidc_transaction WHERE id_hash = ?').run(hash);
			return row;
		})();
		if (!transaction || this.now() >= transaction.expires_at) return null;
		return decryptJson<OidcTransaction>(transaction.encrypted_payload, this.key);
	}
	private hash(value: string) {
		return createHash('sha256').update(value).digest('hex');
	}
}
