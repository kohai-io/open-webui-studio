import { defineConfig } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
process.env.DIRECTOR_E2E_DB ??= resolve(`data/director-e2e-${randomUUID()}.db`);
process.env.DIRECTOR_E2E_KEY ??= randomBytes(32).toString('base64');
export default defineConfig({
	testMatch: 'tests/director.e2e.ts',
	workers: 1,
	timeout: 120000,
	use: {
		baseURL: 'http://127.0.0.1:4176/studio/',
		viewport: { width: 1500, height: 1050 },
		trace: 'retain-on-failure'
	},
	webServer: {
		command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4176',
		port: 4176,
		timeout: 120000,
		env: {
			STUDIO_DATABASE_PATH: process.env.DIRECTOR_E2E_DB,
			SESSION_ENCRYPTION_KEY: process.env.DIRECTOR_E2E_KEY,
			OIDC_ISSUER_URL: 'https://identity.test',
			OIDC_CLIENT_ID: 'browser-test',
			OWUI_BASE_URL: 'http://127.0.0.1:18918',
			FLOW_WORKER_ENABLED: 'false',
			DIRECTOR_ENABLED: 'true',
			DIRECTOR_WORKER_ENABLED: 'true',
			BODY_SIZE_LIMIT: '12M'
		}
	}
});
