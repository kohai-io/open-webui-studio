import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openStudioDatabase } from '$lib/server/database/database';
import { encryptJson } from './crypto';
import { SessionStore, type SessionPayload } from './store';

const payload: SessionPayload = {
	issuer: 'https://id.example.test',
	subject: 'subject-a',
	owuiUserId: 'user-a',
	owuiToken: 'super-secret-owui-token',
	owuiTokenExpiresAt: 2_000_000_000
};

describe('SessionStore', () => {
	it('applies migrations idempotently and encrypts tokens at rest', () => {
		const database = openStudioDatabase(':memory:');
		const store = new SessionStore({ database, encryptionKey: randomBytes(32) });
		const session = store.create(payload);
		const row = database.prepare('SELECT id_hash, encrypted_payload FROM studio_session').get() as {
			id_hash: string;
			encrypted_payload: string;
		};

		expect(row.id_hash).not.toContain(session.handle);
		expect(row.encrypted_payload).not.toContain(payload.owuiToken);
		expect(store.get(session.handle)).toMatchObject({
			...payload,
			owuiTokenExpiresAt: 2_000_000_000_000
		});
		expect(() => openStudioDatabase(':memory:')).not.toThrow();
		database.close();
	});

	it('expires idle sessions and rejects replay after rotation', () => {
		let now = 1_000;
		const database = openStudioDatabase(':memory:');
		const store = new SessionStore({
			database,
			encryptionKey: randomBytes(32),
			now: () => now,
			absoluteTtlMs: 1_000,
			idleTtlMs: 100
		});
		const first = store.create(payload);
		const rotated = store.rotate(first.handle);
		expect(rotated?.handle).not.toBe(first.handle);
		expect(store.get(first.handle)).toBeNull();
		now = 1_101;
		expect(store.get(rotated!.handle)).toBeNull();
		database.close();
	});

	it('normalises token expiry from existing sessions that stored Unix seconds', () => {
		const database = openStudioDatabase(':memory:');
		const encryptionKey = randomBytes(32);
		const store = new SessionStore({ database, encryptionKey });
		const session = store.create({ ...payload, owuiTokenExpiresAt: null });
		database
			.prepare('UPDATE studio_session SET encrypted_payload = ?')
			.run(encryptJson(payload, encryptionKey));

		expect(store.get(session.handle)?.owuiTokenExpiresAt).toBe(2_000_000_000_000);
		database.close();
	});

	it('fails closed if an OIDC subject changes its OWUI identity', () => {
		const database = openStudioDatabase(':memory:');
		const store = new SessionStore({ database, encryptionKey: randomBytes(32) });
		store.create(payload);
		expect(() => store.create({ ...payload, owuiUserId: 'user-b' })).toThrow(
			'OIDC subject binding mismatch'
		);
		database.close();
	});
});
