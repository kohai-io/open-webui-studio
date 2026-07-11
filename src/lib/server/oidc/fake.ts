import type { OidcIdentity, OidcProvider, OidcTransaction } from './provider';

export class FakeOidcProvider implements OidcProvider {
	constructor(
		private readonly issuer = 'https://fake-idp.test',
		private readonly subject = 'subject-a'
	) {}
	async start(redirectUri: string, returnPath: string) {
		const transaction = {
			issuer: this.issuer,
			state: 'state-a',
			nonce: 'nonce-a',
			codeVerifier: 'verifier-a',
			returnPath
		};
		const url = new URL('/authorize', this.issuer);
		url.search = new URLSearchParams({
			redirect_uri: redirectUri,
			response_type: 'code',
			scope: 'openid profile email',
			state: transaction.state,
			nonce: transaction.nonce,
			code_challenge_method: 'S256'
		}).toString();
		return { url, transaction };
	}
	async callback(
		currentUrl: URL,
		_redirectUri: string,
		transaction: OidcTransaction
	): Promise<OidcIdentity> {
		if (
			currentUrl.searchParams.get('state') !== transaction.state ||
			currentUrl.searchParams.get('code') !== 'valid-code'
		)
			throw new Error('Invalid fake authorization response');
		return { issuer: this.issuer, subject: this.subject, accessToken: 'fake-provider-token' };
	}
}
