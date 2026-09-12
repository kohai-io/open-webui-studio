import { defineConfig } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
process.env.IMAGE_E2E_DB ??= resolve(`data/image-e2e-${randomUUID()}.db`);
process.env.IMAGE_E2E_KEY ??= randomBytes(32).toString('base64');
export default defineConfig({
	testMatch: 'tests/image-flow.e2e.ts',
	workers: 1,
	timeout: 60_000,
	use: { baseURL: 'http://127.0.0.1:4175/studio/', viewport: { width: 1440, height: 1100 } },
	webServer: {
		command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4175',
		port: 4175,
		timeout: 120_000,
		env: {
			STUDIO_DATABASE_PATH: process.env.IMAGE_E2E_DB,
			SESSION_ENCRYPTION_KEY: process.env.IMAGE_E2E_KEY,
			OIDC_ISSUER_URL: 'https://identity.test',
			OIDC_CLIENT_ID: 'browser-test',
			OWUI_BASE_URL: 'http://127.0.0.1:18917',
			FLOW_WORKER_ENABLED: 'true',
			FLOW_WORKER_POLL_MS: '50',
			BODY_SIZE_LIMIT: '12M'
		}
	}
});
