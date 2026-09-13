import { describe, expect, it } from 'vitest';
import { OwuiClient } from './client';

describe('image readiness', () => {
	function client(
		role: 'user' | 'admin',
		generation: unknown,
		edit: unknown,
		allowed: unknown = true
	) {
		const paths: string[] = [];
		return {
			paths,
			client: new OwuiClient({
				baseUrl: 'https://owui.test',
				token: 'token',
				fetch: async (input) => {
					const path = new URL(String(input)).pathname;
					paths.push(path);
					if (path === '/api/v1/auths/')
						return Response.json({
							id: 'user-a',
							name: 'A',
							email: 'a@test',
							role,
							profile_image_url: null
						});
					if (path === '/api/v1/images/config')
						return Response.json({
							ENABLE_IMAGE_GENERATION: generation,
							ENABLE_IMAGE_EDIT: edit,
							IMAGES_OPENAI_API_KEY: 'never-expose-this-secret'
						});
					if (path === '/api/config')
						return Response.json({ features: { enable_image_generation: generation } });
					return Response.json({ features: { image_generation: allowed } });
				}
			})
		};
	}
	it('returns only safe flags from the administrator configuration', async () => {
		const h = client('admin', true, false);
		expect(await h.client.getImageCapabilities()).toEqual({
			generate: 'enabled',
			edit: 'disabled',
			canManage: true
		});
	});
	it('checks effective user permissions without calling the admin endpoint', async () => {
		const h = client('user', true, true, false);
		expect(await h.client.getImageCapabilities()).toEqual({
			generate: 'permission_denied',
			edit: 'permission_denied',
			canManage: false
		});
		expect(h.paths).not.toContain('/api/v1/images/config');
	});
	it('distinguishes a disabled feature from an unknown edit toggle', async () => {
		expect(await client('user', false, true).client.getImageCapabilities()).toEqual({
			generate: 'disabled',
			edit: 'unknown',
			canManage: false
		});
		expect(await client('user', undefined, undefined).client.getImageCapabilities()).toMatchObject({
			generate: 'unknown'
		});
	});
	it('does not report readiness when Open WebUI is unavailable', async () => {
		const h = new OwuiClient({
			baseUrl: 'https://owui.test',
			token: 'token',
			fetch: async () => new Response(null, { status: 503 })
		});
		expect(await h.getImageCapabilities()).toEqual({
			generate: 'unavailable',
			edit: 'unavailable',
			canManage: false
		});
	});
});
