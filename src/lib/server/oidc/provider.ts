import * as oidc from 'openid-client';

export interface OidcTransaction {
	issuer: string;
	state: string;
	nonce: string;
	codeVerifier: string;
	returnPath: string;
}
export interface OidcIdentity {
	issuer: string;
	subject: string;
	accessToken: string;
}
export interface OidcProvider {
	start(
		redirectUri: string,
		returnPath: string
	): Promise<{ url: URL; transaction: OidcTransaction }>;
	callback(
		currentUrl: URL,
		redirectUri: string,
		transaction: OidcTransaction
	): Promise<OidcIdentity>;
}

export interface OpenIdProviderOptions {
	issuer: string;
	clientId: string;
	clientSecret?: string;
	scopes?: string;
}
export class OpenIdProvider implements OidcProvider {
	private configuration?: oidc.Configuration;
	constructor(private readonly options: OpenIdProviderOptions) {}
	async start(redirectUri: string, returnPath: string) {
		const configuration = await this.config();
		const codeVerifier = oidc.randomPKCECodeVerifier();
		const state = oidc.randomState();
		const nonce = oidc.randomNonce();
		const url = oidc.buildAuthorizationUrl(configuration, {
			redirect_uri: redirectUri,
			scope: this.options.scopes ?? 'openid profile email',
			code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
			code_challenge_method: 'S256',
			state,
			nonce
		});
		return {
			url,
			transaction: { issuer: this.options.issuer, state, nonce, codeVerifier, returnPath }
		};
	}
	async callback(
		currentUrl: URL,
		redirectUri: string,
		transaction: OidcTransaction
	): Promise<OidcIdentity> {
		if (transaction.issuer !== this.options.issuer) throw new Error('OIDC issuer mismatch');
		const tokens = await oidc.authorizationCodeGrant(
			await this.config(),
			currentUrl,
			{
				pkceCodeVerifier: transaction.codeVerifier,
				expectedState: transaction.state,
				expectedNonce: transaction.nonce
			},
			{ redirect_uri: redirectUri }
		);
		const claims = tokens.claims();
		if (!claims?.sub || !tokens.access_token)
			throw new Error('OIDC response missing subject or access token');
		return { issuer: this.options.issuer, subject: claims.sub, accessToken: tokens.access_token };
	}
	private async config() {
		return (this.configuration ??= await oidc.discovery(
			new URL(this.options.issuer),
			this.options.clientId,
			this.options.clientSecret
		));
	}
}
