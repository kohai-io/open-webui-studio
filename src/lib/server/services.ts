import { env } from '$env/dynamic/private';
import { openStudioDatabase } from '$lib/server/database/database';
import { FlowCredentialLeaseStore } from '$lib/server/flows/credential-leases';
import { FlowExecutionStore } from '$lib/server/flows/executions';
import { FlowQueueService } from '$lib/server/flows/queue';
import { FlowWorkerRunner } from '$lib/server/flows/runner';
import { FlowStore } from '$lib/server/flows/store';
import { FlowWorker } from '$lib/server/flows/worker';
import { AuthService } from '$lib/server/oidc/auth-service';
import { OpenIdProvider } from '$lib/server/oidc/provider';
import { OidcTransactionStore } from '$lib/server/oidc/transactions';
import { OwuiClient } from '$lib/server/owui/client';
import { decodeSessionKey } from '$lib/server/sessions/crypto';
import { SessionStore } from '$lib/server/sessions/store';

let services:
	| {
			auth: AuthService;
			flowCredentialLeases: FlowCredentialLeaseStore;
			flowExecutions: FlowExecutionStore;
			flowQueue: FlowQueueService;
			flowRunner: FlowWorkerRunner;
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
	const flowCredentialLeases = new FlowCredentialLeaseStore({ database, encryptionKey: key });
	const claimTtlMs = positiveIntegerEnv('FLOW_CLAIM_TTL_MS', 30_000);
	const heartbeatIntervalMs = positiveIntegerEnv('FLOW_HEARTBEAT_INTERVAL_MS', 10_000);
	if (heartbeatIntervalMs >= claimTtlMs)
		throw new Error('FLOW_HEARTBEAT_INTERVAL_MS must be less than FLOW_CLAIM_TTL_MS');
	const flowExecutions = new FlowExecutionStore({
		database,
		encryptionKey: key,
		claimTtlMs,
		maxConcurrent: positiveIntegerEnv('FLOW_MAX_CONCURRENT', 4)
	});
	const flowWorker = new FlowWorker({
		workerId: env.FLOW_WORKER_ID ?? `studio-${process.pid}`,
		executions: flowExecutions,
		credentialLeases: flowCredentialLeases,
		clientForToken: (token) => new OwuiClient({ baseUrl: owuiBaseUrl, token }),
		heartbeatIntervalMs,
		runTimeoutMs: positiveIntegerEnv('FLOW_RUN_TIMEOUT_MS', 10 * 60 * 1000),
		nodeTimeoutMs: positiveIntegerEnv('FLOW_NODE_TIMEOUT_MS', 2 * 60 * 1000)
	});
	const flowRunner = new FlowWorkerRunner({
		worker: flowWorker,
		pollIntervalMs: positiveIntegerEnv('FLOW_WORKER_POLL_MS', 1_000),
		onError: () => console.error(JSON.stringify({ event: 'flow_worker_error' }))
	});
	const flowQueue = new FlowQueueService({
		database,
		executions: flowExecutions,
		credentialLeases: flowCredentialLeases,
		onQueued: () => flowRunner.wake()
	});
	services = {
		sessions,
		flowCredentialLeases,
		flowExecutions,
		flowQueue,
		flowRunner,
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
	if (env.FLOW_WORKER_ENABLED !== 'false') flowRunner.start();
	return services;
}

function positiveIntegerEnv(name: string, fallback: number): number {
	const raw = env[name];
	if (raw === undefined || raw === '') return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 1)
		throw new Error(`${name} must be a positive integer`);
	return value;
}
