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
			token: 'owui-token-user-a'
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
});
