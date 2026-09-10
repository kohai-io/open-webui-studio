import { describe, expect, it } from 'vitest';
import { OwuiClient } from './client';
import { createOwuiStub, stubClientOptions } from './stub';

describe('OwuiClient', () => {
	it('exchanges a provider token only in the request body', async () => {
		const stub = createOwuiStub();
		const client = new OwuiClient({
			...stubClientOptions(stub.fetch),
			requestId: () => 'request-1'
		});
		await expect(client.exchangeToken('oidc', 'provider-secret')).resolves.toMatchObject({
			id: 'user-a',
			token: 'owui-token-user-a',
			expiresAt: 2_000_000_000_000
		});
		const request = stub.requests[0];
		expect(request.url).not.toContain('provider-secret');
		expect(request.headers.get('authorization')).toBeNull();
		expect(await request.json()).toEqual({ token: 'provider-secret' });
	});

	it('normalises user-scoped models, files, Knowledge, and chats', async () => {
		const stub = createOwuiStub({ userId: 'user-a' });
		const client = new OwuiClient({ ...stubClientOptions(stub.fetch), token: 'user-token' });
		expect(await client.getCurrentUser()).toMatchObject({ id: 'user-a' });
		expect(await client.listModels()).toHaveLength(2);
		expect(await client.listWorkspaceModels()).toEqual([
			{
				id: 'assistant-a',
				baseModelId: 'model-a',
				name: 'Research agent',
				tags: ['research'],
				isActive: true
			}
		]);
		expect(await client.listFunctions()).toEqual([]);
		expect((await client.listFiles()).items[0]).toMatchObject({ id: 'file-user-a' });
		expect((await client.listKnowledge()).items[0]).toMatchObject({ id: 'knowledge-user-a' });
		expect(await client.createChat('model-a')).toMatchObject({ id: 'chat-user-a' });
		expect(
			stub.requests.every((request) => request.headers.get('authorization') === 'Bearer user-token')
		).toBe(true);
	});

	it('maps a hidden cross-user resource to not_found without details', async () => {
		const stub = createOwuiStub({ denyPaths: ['/api/v1/files/'] });
		const client = new OwuiClient({
			...stubClientOptions(stub.fetch),
			token: 'user-token',
			requestId: () => 'request-denied'
		});
		await expect(client.listFiles()).rejects.toMatchObject({
			code: 'not_found',
			status: 404,
			requestId: 'request-denied',
			message: 'not_found'
		});
	});

	it('keeps two users fixture data disjoint', async () => {
		const userA = createOwuiStub({ userId: 'user-a' });
		const userB = createOwuiStub({ userId: 'user-b' });
		const clientA = new OwuiClient({ ...stubClientOptions(userA.fetch), token: 'token-a' });
		const clientB = new OwuiClient({ ...stubClientOptions(userB.fetch), token: 'token-b' });

		expect((await clientA.listFiles()).items.map((file) => file.id)).toEqual(['file-user-a']);
		expect((await clientB.listFiles()).items.map((file) => file.id)).toEqual(['file-user-b']);
		expect((await clientA.listKnowledge()).items.map((item) => item.id)).not.toEqual(
			(await clientB.listKnowledge()).items.map((item) => item.id)
		);
	});

	it('retries one transient read but never retries a mutation', async () => {
		const readStub = createOwuiStub({ failFirstPaths: ['/api/models'] });
		const readClient = new OwuiClient({
			...stubClientOptions(readStub.fetch),
			token: 'user-token'
		});
		await expect(readClient.listModels()).resolves.toHaveLength(2);
		expect(readStub.requests).toHaveLength(2);
		const writeStub = createOwuiStub({ failFirstPaths: ['/api/v1/chats/new'] });
		const writeClient = new OwuiClient({
			...stubClientOptions(writeStub.fetch),
			token: 'user-token'
		});
		await expect(writeClient.createChat('model-a')).rejects.toMatchObject({
			code: 'upstream_unavailable',
			status: 503
		});
		expect(writeStub.requests).toHaveLength(1);
	});

	it('fails closed on an invalid upstream contract', async () => {
		const client = new OwuiClient({
			baseUrl: 'https://owui.test',
			token: 'user-token',
			fetch: async () => Response.json({ data: [{ name: 'missing-id' }] })
		});
		await expect(client.listModels()).rejects.toMatchObject({ code: 'invalid_response' });
	});

	it('returns only self-owned media across mixed paginated files', async () => {
		const files = Array.from({ length: 55 }, (_, index) => ({
			id: `other-${index}`,
			userId: 'user-b',
			filename: `other-${index}.mp4`,
			contentType: 'video/mp4'
		}));
		files.splice(3, 0, {
			id: 'owned-image',
			userId: 'admin-a',
			filename: 'owned.png',
			contentType: 'image/png'
		});
		files.push({
			id: 'owned-video',
			userId: 'admin-a',
			filename: 'owned.mp4',
			contentType: 'video/mp4'
		});
		files.push({
			id: 'owned-document',
			userId: 'admin-a',
			filename: 'notes.txt',
			contentType: 'text/plain'
		});
		const stub = createOwuiStub({ userId: 'admin-a', role: 'admin', files });
		const client = new OwuiClient({ ...stubClientOptions(stub.fetch), token: 'admin-token' });

		const first = await client.listMedia('admin-a', null, 1);
		expect(first.items).toEqual([
			expect.objectContaining({ id: 'owned-image', mediaType: 'image' })
		]);
		expect(first.items[0]).not.toHaveProperty('ownerId');
		expect(first.nextCursor).not.toBeNull();

		const second = await client.listMedia('admin-a', first.nextCursor, 10);
		expect(second.items.map((file) => file.id)).toEqual(['owned-video']);
		expect(second.nextCursor).toBeNull();
	});

	it('searches by filename and normalises no matches to an empty page', async () => {
		const stub = createOwuiStub({
			userId: 'admin-a',
			role: 'admin',
			files: [
				{ id: 'image-a', userId: 'admin-a', filename: 'summer.png', contentType: 'image/png' },
				{ id: 'text-a', userId: 'admin-a', filename: 'summer.txt', contentType: 'text/plain' },
				{ id: 'image-b', userId: 'user-b', filename: 'summer-secret.png', contentType: 'image/png' }
			]
		});
		const client = new OwuiClient({ ...stubClientOptions(stub.fetch), token: 'admin-token' });

		await expect(client.searchMedia('admin-a', 'summer')).resolves.toEqual({
			items: [expect.objectContaining({ id: 'image-a', mediaType: 'image' })],
			nextCursor: null
		});
		await expect(client.searchMedia('admin-a', 'winter')).resolves.toEqual({
			items: [],
			nextCursor: null
		});
		await expect(client.searchMedia('admin-a', '*')).rejects.toThrow(TypeError);
	});

	it.each([24, 25, 30, 48, 49, 50, 74])(
		'paginates all %i media search results without omissions or duplicates',
		async (count) => {
			const files = Array.from({ length: count }, (_, index) => ({
				id: `image-${index}`,
				userId: 'user-a',
				filename: `summer-${index}.png`,
				contentType: 'image/png'
			}));
			const stub = createOwuiStub({ userId: 'user-a', files });
			const client = new OwuiClient({ ...stubClientOptions(stub.fetch), token: 'user-token' });
			let cursor: string | null = null;

			for (let offset = 0; offset < count; offset += 24) {
				const page = await client.searchMedia('user-a', 'summer', cursor);
				expect(page.items.map((item) => item.id)).toEqual(
					files.slice(offset, offset + 24).map((file) => file.id)
				);
				if (offset + 24 < count) expect(page.nextCursor).not.toBeNull();
				else expect(page.nextCursor).toBeNull();
				cursor = page.nextCursor;
			}
		}
	);

	it('blocks administrator cross-user preview and download before requesting content', async () => {
		const stub = createOwuiStub({
			userId: 'admin-a',
			role: 'admin',
			files: [
				{
					id: 'owned-video',
					userId: 'admin-a',
					filename: 'owned.mp4',
					contentType: 'video/mp4'
				},
				{
					id: 'other-video',
					userId: 'user-b',
					filename: 'secret.mp4',
					contentType: 'video/mp4'
				}
			]
		});
		const client = new OwuiClient({ ...stubClientOptions(stub.fetch), token: 'admin-token' });

		await expect(client.openMediaContent('other-video', 'admin-a')).rejects.toMatchObject({
			code: 'not_found',
			status: 404
		});
		expect(stub.requests.map((request) => new URL(request.url).pathname)).toEqual([
			'/api/v1/files/other-video'
		]);
	});

	it('proxies owned range content with an allowlisted header set', async () => {
		const stub = createOwuiStub({ userId: 'user-a' });
		const client = new OwuiClient({ ...stubClientOptions(stub.fetch), token: 'user-token' });

		const response = await client.openMediaContent('file-user-a', 'user-a', 'download', 'bytes=0-');
		expect(response.status).toBe(206);
		expect(response.headers.get('content-type')).toBe('video/mp4');
		expect(response.headers.get('content-disposition')).toContain('attachment');
		expect(response.headers.get('content-range')).toBe('bytes 0-4/13');
		expect(response.headers.get('x-secret-upstream-header')).toBeNull();
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
		expect(response.headers.get('content-security-policy')).toContain('sandbox');
		expect(await response.text()).toBe('video-content');
		const contentRequest = stub.requests.at(-1);
		expect(contentRequest?.headers.get('range')).toBe('bytes=0-');
		expect(contentRequest?.headers.get('authorization')).toBe('Bearer user-token');
	});

	it('excludes conflicting or unsupported media metadata', async () => {
		const stub = createOwuiStub({
			userId: 'user-a',
			files: [
				{ id: 'fallback', userId: 'user-a', filename: 'recording.wav', contentType: null },
				{ id: 'conflict', userId: 'user-a', filename: 'photo.jpg', contentType: 'video/mp4' },
				{ id: 'document', userId: 'user-a', filename: 'notes.pdf', contentType: 'application/pdf' },
				{
					id: 'active-image',
					userId: 'user-a',
					filename: 'active.svg',
					contentType: 'image/svg+xml'
				}
			]
		});
		const client = new OwuiClient({ ...stubClientOptions(stub.fetch), token: 'user-token' });

		const result = await client.listMedia('user-a');
		expect(result.items).toEqual([
			expect.objectContaining({ id: 'fallback', mediaType: 'audio', contentType: null })
		]);
	});

	it('scans representative mixed libraries in bounded sequential batches', async () => {
		const files = Array.from({ length: 1_250 }, (_, index) => ({
			id: `other-${index}`,
			userId: 'user-b',
			filename: `document-${index}.txt`,
			contentType: 'text/plain'
		}));
		files[520] = {
			id: 'owned-image',
			userId: 'admin-a',
			filename: 'owned-image.png',
			contentType: 'image/png'
		};
		files[1_050] = {
			id: 'owned-video',
			userId: 'admin-a',
			filename: 'owned-video.mp4',
			contentType: 'video/mp4'
		};
		const stub = createOwuiStub({ userId: 'admin-a', role: 'admin', files });
		let active = 0;
		let maxActive = 0;
		const fetch: typeof globalThis.fetch = async (input, init) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			try {
				await new Promise((resolve) => setTimeout(resolve, 1));
				return await stub.fetch(input, init);
			} finally {
				active -= 1;
			}
		};
		const client = new OwuiClient({ ...stubClientOptions(fetch), token: 'admin-token' });

		const first = await client.listMedia('admin-a');
		expect(first.items).toEqual([]);
		expect(first.nextCursor).not.toBeNull();
		expect(stub.requests).toHaveLength(10);

		const second = await client.listMedia('admin-a', first.nextCursor);
		expect(second.items.map((item) => item.id)).toEqual(['owned-image']);
		expect(second.nextCursor).not.toBeNull();

		const third = await client.listMedia('admin-a', second.nextCursor);
		expect(third.items.map((item) => item.id)).toEqual(['owned-video']);
		expect(third.nextCursor).toBeNull();
		expect(maxActive).toBe(1);
		expect(stub.requests.length).toBeLessThanOrEqual(25);
	});

	it('propagates caller cancellation instead of retrying or remapping it', async () => {
		const controller = new AbortController();
		let attempts = 0;
		const fetch: typeof globalThis.fetch = async (_input, init) => {
			attempts += 1;
			return await new Promise<Response>((_resolve, reject) => {
				const signal = init?.signal;
				if (!signal) return reject(new Error('signal missing'));
				if (signal.aborted) return reject(signal.reason);
				signal.addEventListener('abort', () => reject(signal.reason), { once: true });
			});
		};
		const client = new OwuiClient({ baseUrl: 'https://owui.test', token: 'user-token', fetch });

		const pending = client.listMedia('user-a', null, 24, controller.signal);
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(attempts).toBe(1);
	});

	it('fails safely when an owned file disappears before content streaming', async () => {
		const stub = createOwuiStub({ userId: 'user-a' });
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const path = new URL(input instanceof Request ? input.url : input).pathname;
			if (path.endsWith('/api/v1/files/file-user-a/content'))
				return Response.json({ detail: 'Not found' }, { status: 404 });
			return stub.fetch(input, init);
		};
		const client = new OwuiClient({ ...stubClientOptions(fetch), token: 'user-token' });

		await expect(client.openMediaContent('file-user-a', 'user-a')).rejects.toMatchObject({
			code: 'not_found',
			status: 404,
			message: 'not_found'
		});
	});
});
