import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openStudioDatabase } from '$lib/server/database/database';
import { OwuiClient } from '$lib/server/owui/client';
import { createOwuiStub, stubClientOptions } from '$lib/server/owui/stub';
import { SessionStore } from '$lib/server/sessions/store';
import { AuthService, safeReturnPath } from './auth-service';
import { FakeOidcProvider } from './fake';
import { OidcTransactionStore } from './transactions';

function harness() {
	const database = openStudioDatabase(':memory:');
	const key = randomBytes(32);
	const stub = createOwuiStub();
	const sessions = new SessionStore({ database, encryptionKey: key });
	const auth = new AuthService(
		'oidc',
		new FakeOidcProvider(),
		new OidcTransactionStore(database, key),
		new OwuiClient({ ...stubClientOptions(stub.fetch) }),
		sessions
	);
	return { database, auth, sessions };
}

describe('AuthService', () => {
	it('completes a fake OIDC flow and creates an encrypted server session', async () => {
		const { database, auth, sessions } = harness();
		const started = await auth.begin('https://studio.test/studio/auth/callback', '/studio/agents');
		expect(started.authorizationUrl.searchParams.get('state')).toBe('state-a');
		const completed = await auth.complete(
			new URL('https://studio.test/studio/auth/callback?code=valid-code&state=state-a'),
			'https://studio.test/studio/auth/callback',
			started.transactionHandle
		);
		expect(completed.returnPath).toBe('/studio/agents');
		expect(sessions.get(completed.session.handle)).toMatchObject({
			issuer: 'https://fake-idp.test',
			subject: 'subject-a',
			owuiUserId: 'user-a'
		});
		database.close();
	});

	it('rejects callback transaction replay', async () => {
		const { database, auth } = harness();
		const started = await auth.begin('https://studio.test/studio/auth/callback', '/studio');
		const callback = new URL(
			'https://studio.test/studio/auth/callback?code=valid-code&state=state-a'
		);
		await auth.complete(callback, callback.origin, started.transactionHandle);
		await expect(
			auth.complete(callback, callback.origin, started.transactionHandle)
		).rejects.toThrow('OIDC transaction is missing, expired, or already used');
		database.close();
	});

	it('rejects unsafe return paths', () => {
		expect(safeReturnPath('https://evil.test/studio')).toBe('/studio');
		expect(safeReturnPath('//evil.test/studio')).toBe('/studio');
		expect(safeReturnPath('/studio/media?page=2')).toBe('/studio/media?page=2');
	});
});
