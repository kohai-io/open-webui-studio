import { describe, expect, it } from 'vitest';
import { OwuiClient } from './owui/client';
import { OwuiError } from './owui/errors';
import { createOwuiStub, stubClientOptions } from './owui/stub';
import { loadCatalogue, publicCatalogueError } from './catalogue';
import { openStudioDatabase } from './database/database';
import { AgentStore } from './agents/store';

describe('catalogue', () => {
	it('lists OWUI models and only Studio agents backed by an available model', async () => {
		const stub = createOwuiStub();
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const request = new Request(input, init);
			if (new URL(request.url).pathname.endsWith('/api/models')) {
				return Response.json({
					data: [{ id: 'model-a', name: 'Model A' }]
				});
			}
			return stub.fetch(request);
		};
		const client = new OwuiClient({ ...stubClientOptions(fetch), token: 'user-token' });
		const agents = new AgentStore(openStudioDatabase(':memory:'), () => 100);
		agents.create('user-a', { name: 'Agent A', description: '', modelId: 'model-a' });
		agents.create('user-a', { name: 'Hidden', description: '', modelId: 'model-hidden' });

		await expect(loadCatalogue(client, agents, 'user-a')).resolves.toMatchObject({
			user: { id: 'user-a' },
			models: [{ id: 'model-a', kind: 'model' }],
			agents: [{ name: 'Agent A', modelId: 'model-a' }]
		});
	});

	it('does not expose upstream error details to pages', () => {
		expect(publicCatalogueError(new OwuiError('not_found', 404, 'request-1'))).toBe(
			'permission_denied'
		);
		expect(publicCatalogueError(new Error('private upstream detail'))).toBe('upstream_unavailable');
	});
});
