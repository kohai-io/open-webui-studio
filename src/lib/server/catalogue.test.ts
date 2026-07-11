import { describe, expect, it } from 'vitest';
import { OwuiClient } from './owui/client';
import { OwuiError } from './owui/errors';
import { createOwuiStub, stubClientOptions } from './owui/stub';
import { loadCatalogue, publicCatalogueError } from './catalogue';

describe('catalogue', () => {
	it("separates only the current user's available models and agents", async () => {
		const stub = createOwuiStub();
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const request = new Request(input, init);
			if (new URL(request.url).pathname.endsWith('/api/models')) {
				return Response.json({
					data: [
						{ id: 'model-a', name: 'Model A' },
						{ id: 'agent-a', name: 'Agent A', info: { meta: { type: 'agent' } } }
					]
				});
			}
			return stub.fetch(request);
		};
		const client = new OwuiClient({ ...stubClientOptions(fetch), token: 'user-token' });

		await expect(loadCatalogue(client)).resolves.toMatchObject({
			user: { id: 'user-a' },
			models: [{ id: 'model-a', kind: 'model' }],
			agents: [{ id: 'agent-a', kind: 'agent' }]
		});
	});

	it('does not expose upstream error details to pages', () => {
		expect(publicCatalogueError(new OwuiError('not_found', 404, 'request-1'))).toBe(
			'permission_denied'
		);
		expect(publicCatalogueError(new Error('private upstream detail'))).toBe('upstream_unavailable');
	});
});
