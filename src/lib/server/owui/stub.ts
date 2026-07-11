import type { OwuiClientOptions } from './client';
export interface OwuiStubOptions {
	userId?: string;
	role?: 'user' | 'admin';
	files?: OwuiStubFile[];
	denyPaths?: string[];
	failFirstPaths?: string[];
	completionResponse?: unknown;
}
export interface OwuiStubFile {
	id: string;
	userId: string;
	filename: string;
	contentType?: string | null;
	size?: number | null;
	createdAt?: number;
	updatedAt?: number | null;
	content?: string;
}
export function createOwuiStub(options: OwuiStubOptions = {}): {
	fetch: typeof globalThis.fetch;
	requests: Request[];
} {
	const userId = options.userId ?? 'user-a';
	const role = options.role ?? 'user';
	const files = options.files ?? [
		{
			id: `file-${userId}`,
			userId,
			filename: 'clip.mp4',
			contentType: 'video/mp4',
			size: 42,
			createdAt: 100,
			updatedAt: 101,
			content: 'video-content'
		}
	];
	const requests: Request[] = [];
	const failures = new Set(options.failFirstPaths ?? []);
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const request = new Request(input, init);
		requests.push(request);
		const path = new URL(request.url).pathname;
		if (options.denyPaths?.includes(path)) return json({ detail: 'Not found' }, 404);
		if (failures.delete(path)) return json({ detail: 'Unavailable' }, 503);
		if (path.endsWith('/api/v1/auths/')) return json(user(userId, role));
		if (path.includes('/oauth/') && path.endsWith('/token/exchange'))
			return json({
				...user(userId, role),
				token: `owui-token-${userId}`,
				expires_at: 2_000_000_000
			});
		if (path.endsWith('/api/models'))
			return json({
				data: [
					{ id: 'model-a', name: 'Model A', tags: [{ name: 'allowed' }] },
					{ id: 'assistant-a', name: 'Assistant A', info: { meta: { type: 'agent' } } }
				]
			});
		if (path.endsWith('/api/v1/models/list'))
			return json({
				items: [
					{
						id: 'assistant-a',
						base_model_id: 'model-a',
						name: 'Research agent',
						meta: { tags: [{ name: 'research' }] },
						is_active: true
					}
				],
				total: 1
			});
		if (path.endsWith('/api/v1/functions/')) return json([]);
		if (path.endsWith('/api/chat/completions'))
			return json(
				options.completionResponse ?? {
					id: 'completion-a',
					choices: [{ index: 0, message: { role: 'assistant', content: 'Completed text' } }]
				}
			);
		if (path.endsWith('/api/v1/files/')) {
			const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
			const visible = role === 'admin' ? files : files.filter((file) => file.userId === userId);
			const start = (page - 1) * 50;
			return json({
				items: visible.slice(start, start + 50).map(fileResponse),
				total: visible.length
			});
		}
		if (path.endsWith('/api/v1/files/search')) {
			const params = new URL(request.url).searchParams;
			const query = (params.get('filename') ?? '').replaceAll('*', '').toLowerCase();
			const skip = Number(params.get('skip') ?? '0');
			const limit = Number(params.get('limit') ?? '100');
			const visible = (role === 'admin' ? files : files.filter((file) => file.userId === userId))
				.filter((file) => file.filename.toLowerCase().includes(query))
				.slice(skip, skip + limit);
			return visible.length === 0
				? json({ detail: 'No files found matching the pattern.' }, 404)
				: json(visible.map(fileResponse));
		}
		const contentMatch = path.match(/\/api\/v1\/files\/([^/]+)\/content$/);
		if (contentMatch) {
			const file = files.find((candidate) => candidate.id === decodeURIComponent(contentMatch[1]));
			if (!file || (role !== 'admin' && file.userId !== userId))
				return json({ detail: 'Not found' }, 404);
			const headers = new Headers({
				'content-type': file.contentType ?? 'application/octet-stream',
				'content-disposition': new URL(request.url).searchParams.has('attachment')
					? `attachment; filename="${file.filename}"`
					: `inline; filename="${file.filename}"`,
				'accept-ranges': 'bytes',
				'x-secret-upstream-header': 'must-not-be-forwarded'
			});
			const status = request.headers.has('range') ? 206 : 200;
			if (status === 206) headers.set('content-range', 'bytes 0-4/13');
			return new Response(file.content ?? 'media-content', { status, headers });
		}
		const fileMatch = path.match(/\/api\/v1\/files\/([^/]+)$/);
		if (fileMatch) {
			const file = files.find((candidate) => candidate.id === decodeURIComponent(fileMatch[1]));
			if (!file || (role !== 'admin' && file.userId !== userId))
				return json({ detail: 'Not found' }, 404);
			return json(fileResponse(file));
		}
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
function user(id: string, role: 'user' | 'admin') {
	return { id, email: `${id}@example.test`, name: id, role, profile_image_url: null };
}
function fileResponse(file: OwuiStubFile) {
	return {
		id: file.id,
		user_id: file.userId,
		filename: file.filename,
		meta: { content_type: file.contentType ?? null, size: file.size ?? null },
		created_at: file.createdAt ?? 100,
		updated_at: file.updatedAt ?? null
	};
}
function json(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: { 'content-type': 'application/json' } });
}
