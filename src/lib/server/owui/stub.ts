import type { OwuiClientOptions } from './client';
export interface OwuiStubOptions {
	userId?: string;
	denyPaths?: string[];
	failFirstPaths?: string[];
}
export function createOwuiStub(options: OwuiStubOptions = {}): {
	fetch: typeof globalThis.fetch;
	requests: Request[];
} {
	const userId = options.userId ?? 'user-a';
	const requests: Request[] = [];
	const failures = new Set(options.failFirstPaths ?? []);
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const request = new Request(input, init);
		requests.push(request);
		const path = new URL(request.url).pathname;
		if (options.denyPaths?.includes(path)) return json({ detail: 'Not found' }, 404);
		if (failures.delete(path)) return json({ detail: 'Unavailable' }, 503);
		if (path.endsWith('/api/v1/auths/')) return json(user(userId));
		if (path.includes('/oauth/') && path.endsWith('/token/exchange'))
			return json({ ...user(userId), token: `owui-token-${userId}`, expires_at: 2_000_000_000 });
		if (path.endsWith('/api/models'))
			return json({ data: [{ id: 'model-a', name: 'Model A', tags: [{ name: 'allowed' }] }] });
		if (path.endsWith('/api/v1/files/'))
			return json({
				items: [
					{
						id: `file-${userId}`,
						user_id: userId,
						filename: 'clip.mp4',
						meta: { content_type: 'video/mp4', size: 42 },
						created_at: 100,
						updated_at: 101
					}
				],
				total: 1
			});
		if (path.endsWith('/api/v1/knowledge/'))
			return json({
				items: [
					{
						id: `knowledge-${userId}`,
						user_id: userId,
						name: 'Reference',
						description: 'User-scoped fixture',
						write_access: true,
						created_at: 100,
						updated_at: 101
					}
				],
				total: 1
			});
		if (path.endsWith('/api/v1/chats/new'))
			return json({
				id: `chat-${userId}`,
				user_id: userId,
				title: 'New chat',
				chat: {},
				updated_at: 101
			});
		return json({ detail: 'Not found' }, 404);
	};
	return { fetch, requests };
}
export function stubClientOptions(
	fetch: typeof globalThis.fetch
): Pick<OwuiClientOptions, 'baseUrl' | 'fetch'> {
	return { baseUrl: 'https://owui.test/', fetch };
}
function user(id: string) {
	return { id, email: `${id}@example.test`, name: id, role: 'user', profile_image_url: null };
}
function json(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: { 'content-type': 'application/json' } });
}
