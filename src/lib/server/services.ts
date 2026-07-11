import { env } from '$env/dynamic/private';
import { openStudioDatabase } from '$lib/server/database/database';
import { FlowStore } from '$lib/server/flows/store';
import { AuthService } from '$lib/server/oidc/auth-service';
import { OpenIdProvider } from '$lib/server/oidc/provider';
import { OidcTransactionStore } from '$lib/server/oidc/transactions';
import { OwuiClient } from '$lib/server/owui/client';
import { decodeSessionKey } from '$lib/server/sessions/crypto';
import { SessionStore } from '$lib/server/sessions/store';

let services:
	| {
			auth: AuthService;
			flows: FlowStore;
			sessions: SessionStore;
			owuiForToken: (token: string) => OwuiClient;
			owuiPublicUrl: string;
	  }
	| undefined;
export function getServices() {
	if (services) return services;
	const required = (name: string): string => {
		const value = env[name];
		if (!value) throw new Error(`${name} is required`);
		return value;
	};
	const issuer = required('OIDC_ISSUER_URL');
	const clientId = required('OIDC_CLIENT_ID');
	const owuiBaseUrl = required('OWUI_BASE_URL');
	const encryptionKey = required('SESSION_ENCRYPTION_KEY');
	const database = openStudioDatabase(env.STUDIO_DATABASE_PATH ?? './data/studio.db');
	const key = decodeSessionKey(encryptionKey);
	const sessions = new SessionStore({ database, encryptionKey: key });
	const provider = new OpenIdProvider({
		issuer,
		clientId,
		clientSecret: env.OIDC_CLIENT_SECRET || undefined,
		scopes: env.OIDC_SCOPES || undefined
	});
	const transactions = new OidcTransactionStore(database, key);
	const owui = new OwuiClient({ baseUrl: owuiBaseUrl });
	services = {
		sessions,
		flows: new FlowStore(database),
		auth: new AuthService(
			env.OWUI_OAUTH_PROVIDER ?? 'oidc',
			provider,
			transactions,
			owui,
			sessions
		),
		owuiForToken: (token) => new OwuiClient({ baseUrl: owuiBaseUrl, token }),
		owuiPublicUrl: env.OWUI_PUBLIC_URL ?? owuiBaseUrl
	};
	return services;
}
