import type { OwuiClient } from '$lib/server/owui/client';
import type { SessionStore, StoredSession } from '$lib/server/sessions/store';
import type { OidcProvider } from './provider';
import type { OidcTransactionStore } from './transactions';

export class AuthService {
	constructor(
		private readonly providerName: string,
		private readonly provider: OidcProvider,
		private readonly transactions: OidcTransactionStore,
		private readonly owui: OwuiClient,
		private readonly sessions: SessionStore
	) {}
	async begin(redirectUri: string, requestedReturnPath: string | null) {
		const returnPath = safeReturnPath(requestedReturnPath);
		const started = await this.provider.start(redirectUri, returnPath);
		return {
			authorizationUrl: started.url,
			transactionHandle: this.transactions.create(started.transaction)
		};
	}
	async complete(
		currentUrl: URL,
		redirectUri: string,
		transactionHandle: string
	): Promise<{ session: StoredSession; returnPath: string }> {
		const transaction = this.transactions.consume(transactionHandle);
		if (!transaction) throw new Error('OIDC transaction is missing, expired, or already used');
		const identity = await this.provider.callback(currentUrl, redirectUri, transaction);
		const owui = await this.owui.exchangeToken(this.providerName, identity.accessToken);
		return {
			session: this.sessions.create({
				issuer: identity.issuer,
				subject: identity.subject,
				owuiUserId: owui.id,
				owuiToken: owui.token,
				owuiTokenExpiresAt: owui.expiresAt
			}),
			returnPath: transaction.returnPath
		};
	}
}

export function safeReturnPath(value: string | null): string {
	if (!value) return '/studio';
	if (!value.startsWith('/studio') || value.startsWith('//') || value.includes('\\'))
		return '/studio';
	try {
		const parsed = new URL(value, 'https://studio.invalid');
		return parsed.origin === 'https://studio.invalid'
			? `${parsed.pathname}${parsed.search}${parsed.hash}`
			: '/studio';
	} catch {
		return '/studio';
	}
}
