import { isFlowImages, type FlowImages, type FlowImageNodeV1 } from '$lib/flows/types';
import { randomUUID } from 'node:crypto';
import type { ImageCapabilities, ImageCapabilityState } from '$lib/flows/capabilities';
import { normaliseEpochMilliseconds } from '$lib/server/time';
import type {
	OwuiChat,
	OwuiFileSummary,
	OwuiKnowledgeSummary,
	OwuiModel,
	OwuiFunction,
	OwuiWorkspaceModel,
	OwuiPage,
	OwuiSession,
	OwuiTextCompletion,
	OwuiTextCompletionRequest,
	StudioMediaPage,
	StudioMediaSummary,
	StudioMediaType,
	StudioUser,
	StudioUserRole
} from './contracts';
import { mapOwuiStatus, OwuiError } from './errors';
import {
	array,
	nullableNumber,
	nullableString,
	number,
	object,
	string,
	type JsonObject
} from './validation';

export interface OwuiClientOptions {
	baseUrl: string;
	token?: string;
	fetch?: typeof globalThis.fetch;
	requestId?: () => string;
	timeoutMs?: number;
}
interface RequestOptions {
	timeoutMs?: number;
	formData?: FormData;
	method?: 'GET' | 'POST' | 'DELETE';
	body?: unknown;
	authenticated?: boolean;
	idempotent?: boolean;
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

const OWUI_FILE_PAGE_SIZE = 50;
const MEDIA_SCAN_LIMIT = 500;
const TEXT_COMPLETION_MAX_CONTENT_LENGTH = 1024 * 1024;
const TEXT_COMPLETION_MAX_STREAM_BYTES = 4 * TEXT_COMPLETION_MAX_CONTENT_LENGTH;
const MEDIA_RESPONSE_HEADERS = new Set([
	'accept-ranges',
	'content-disposition',
	'content-length',
	'content-range',
	'content-type',
	'etag',
	'last-modified'
]);
const MEDIA_EXTENSIONS: Record<StudioMediaType, Set<string>> = {
	image: new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tif', 'tiff']),
	video: new Set(['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v', 'ogv']),
	audio: new Set(['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus'])
};

export class OwuiClient {
	private readonly baseUrl: URL;
	private readonly fetcher: typeof globalThis.fetch;
	private readonly nextRequestId: () => string;
	private readonly timeoutMs: number;
	constructor(private readonly options: OwuiClientOptions) {
		this.baseUrl = new URL(options.baseUrl.endsWith('/') ? options.baseUrl : `${options.baseUrl}/`);
		this.fetcher = options.fetch ?? globalThis.fetch;
		this.nextRequestId = options.requestId ?? randomUUID;
		this.timeoutMs = options.timeoutMs ?? 10_000;
	}

	async exchangeToken(provider: string, providerToken: string): Promise<OwuiSession> {
		if (!/^[a-z0-9_-]+$/i.test(provider)) throw new TypeError('Invalid OAuth provider name');
		const { payload, requestId } = await this.request(
			`api/v1/auths/oauth/${provider}/token/exchange`,
			{ method: 'POST', body: { token: providerToken }, authenticated: false }
		);
		const value = object(payload, requestId);
		return {
			...this.user(value, requestId),
			token: string(value.token, requestId),
			expiresAt: normaliseEpochMilliseconds(nullableNumber(value.expires_at, requestId))
		};
	}

	async getCurrentUser(): Promise<StudioUser> {
		const { payload, requestId } = await this.request('api/v1/auths/');
		return this.user(object(payload, requestId), requestId);
	}

	async getImageCapabilities(): Promise<ImageCapabilities> {
		const unknown: ImageCapabilities = {
			generate: 'unavailable',
			edit: 'unavailable',
			canManage: false
		};
		try {
			const user = await this.getCurrentUser();
			const state = (value: unknown): ImageCapabilityState =>
				value === true ? 'enabled' : value === false ? 'disabled' : 'unknown';
			if (user.role === 'admin') {
				// The upstream admin response includes credentials. Return only these flags.
				const { payload, requestId } = await this.request('api/v1/images/config');
				const config = object(payload, requestId);
				return {
					generate: state(config.ENABLE_IMAGE_GENERATION),
					edit: state(config.ENABLE_IMAGE_EDIT),
					canManage: true
				};
			}
			const [config, permissions] = await Promise.all([
				this.request('api/config'),
				this.request('api/v1/users/permissions')
			]);
			const features = this.optionalObject(object(config.payload, config.requestId).features);
			const allowed = this.optionalObject(
				object(permissions.payload, permissions.requestId).features
			)?.image_generation;
			return {
				generate:
					features?.enable_image_generation === false
						? 'disabled'
						: allowed === false
							? 'permission_denied'
							: allowed === true
								? state(features?.enable_image_generation)
								: 'unknown',
				// v0.10.2 exposes the edit toggle only to administrators.
				edit: allowed === false ? 'permission_denied' : 'unknown',
				canManage: false
			};
		} catch {
			return unknown;
		}
	}

	async listModels(signal?: AbortSignal): Promise<OwuiModel[]> {
		const { payload, requestId } = await this.request('api/models', { signal });
		return array(object(payload, requestId).data, requestId).map((entry) => {
			const model = object(entry, requestId);
			const info = this.optionalObject(model.info);
			const meta = this.optionalObject(info?.meta);
			const tags = Array.isArray(model.tags)
				? model.tags.flatMap((tag) => {
						const name = this.optionalObject(tag)?.name;
						return typeof name === 'string' ? [name] : [];
					})
				: [];
			return {
				id: string(model.id, requestId),
				name: typeof model.name === 'string' ? model.name : string(model.id, requestId),
				kind: meta?.type === 'agent' ? 'agent' : 'model',
				tags
			};
		});
	}

	async listWorkspaceModels(signal?: AbortSignal): Promise<OwuiWorkspaceModel[]> {
		const items: OwuiWorkspaceModel[] = [];
		for (let page = 1; ; page += 1) {
			const { payload, requestId } = await this.request(`api/v1/models/list?page=${page}`, {
				signal
			});
			const root = object(payload, requestId);
			for (const entry of array(root.items, requestId)) {
				const model = object(entry, requestId);
				const meta = this.optionalObject(model.meta);
				const tags = Array.isArray(meta?.tags)
					? meta.tags.flatMap((tag) => {
							const name = this.optionalObject(tag)?.name;
							return typeof name === 'string' ? [name] : [];
						})
					: [];
				items.push({
					id: string(model.id, requestId),
					baseModelId: nullableString(model.base_model_id, requestId),
					name: string(model.name, requestId),
					tags,
					isActive: model.is_active === true
				});
			}
			const total = number(root.total, requestId);
			if (items.length >= total || array(root.items, requestId).length === 0) return items;
		}
	}

	async listFunctions(signal?: AbortSignal): Promise<OwuiFunction[]> {
		const { payload, requestId } = await this.request('api/v1/functions/', { signal });
		return array(payload, requestId).map((entry) => {
			const fn = object(entry, requestId);
			return { id: string(fn.id, requestId), isActive: fn.is_active === true };
		});
	}

	async listFiles(page = 1, signal?: AbortSignal): Promise<OwuiPage<OwuiFileSummary>> {
		this.page(page);
		const { payload, requestId } = await this.request(`api/v1/files/?page=${page}&content=false`, {
			signal
		});
		const root = object(payload, requestId);
		return {
			items: array(root.items, requestId).map((entry) => {
				return this.fileSummary(object(entry, requestId), requestId);
			}),
			total: number(root.total, requestId),
			page
		};
	}

	async listMedia(
		ownerId: string,
		cursor: string | null = null,
		limit = 24,
		signal?: AbortSignal
	): Promise<StudioMediaPage> {
		this.owner(ownerId);
		this.limit(limit);
		let position = this.cursor(cursor, 'list');
		let scanned = 0;
		const items: StudioMediaSummary[] = [];
		let total = Number.POSITIVE_INFINITY;

		while (items.length < limit && position < total && scanned < MEDIA_SCAN_LIMIT) {
			const page = Math.floor(position / OWUI_FILE_PAGE_SIZE) + 1;
			const offset = position % OWUI_FILE_PAGE_SIZE;
			const result = await this.listFiles(page, signal);
			total = result.total;
			const candidates = result.items.slice(offset);
			if (candidates.length === 0) break;

			for (const file of candidates) {
				position += 1;
				scanned += 1;
				const media = this.mediaSummary(file);
				if (file.ownerId === ownerId && media) items.push(media);
				if (items.length === limit || scanned === MEDIA_SCAN_LIMIT) break;
			}
		}

		return {
			items,
			nextCursor: position < total ? this.encodeCursor('list', position) : null
		};
	}

	async searchMedia(
		ownerId: string,
		query: string,
		cursor: string | null = null,
		limit = 24,
		signal?: AbortSignal
	): Promise<StudioMediaPage> {
		this.owner(ownerId);
		this.limit(limit);
		const normalizedQuery = query.trim();
		const hasUnsupportedCharacter = [...normalizedQuery].some(
			(character) => character === '*' || character === '?' || character.charCodeAt(0) < 32
		);
		if (!normalizedQuery || normalizedQuery.length > 200 || hasUnsupportedCharacter)
			throw new TypeError('query must be 1-200 characters without wildcard or control characters');

		let position = this.cursor(cursor, 'search');
		let scanned = 0;
		let hasMore = true;
		const items: StudioMediaSummary[] = [];
		while (items.length < limit && hasMore && scanned < MEDIA_SCAN_LIMIT) {
			let batch: OwuiFileSummary[];
			try {
				const params = new URLSearchParams({
					filename: `*${normalizedQuery}*`,
					content: 'false',
					skip: String(position),
					limit: String(OWUI_FILE_PAGE_SIZE)
				});
				const { payload, requestId } = await this.request(`api/v1/files/search?${params}`, {
					signal
				});
				batch = array(payload, requestId).map((entry) =>
					this.fileSummary(object(entry, requestId), requestId)
				);
			} catch (error) {
				if (error instanceof OwuiError && error.code === 'not_found') batch = [];
				else throw error;
			}

			if (batch.length === 0) {
				hasMore = false;
				break;
			}
			const batchStart = position;
			for (const file of batch) {
				position += 1;
				scanned += 1;
				const media = this.mediaSummary(file);
				if (file.ownerId === ownerId && media) items.push(media);
				if (items.length === limit || scanned === MEDIA_SCAN_LIMIT) break;
			}
			const consumedBatch = position - batchStart === batch.length;
			if (consumedBatch && batch.length < OWUI_FILE_PAGE_SIZE) hasMore = false;
		}

		return {
			items,
			nextCursor: hasMore ? this.encodeCursor('search', position) : null
		};
	}

	async getOwnedMedia(
		id: string,
		ownerId: string,
		signal?: AbortSignal
	): Promise<StudioMediaSummary> {
		if (!id) throw new TypeError('id is required');
		this.owner(ownerId);
		const { payload, requestId } = await this.request(`api/v1/files/${encodeURIComponent(id)}`, {
			signal
		});
		const file = this.fileSummary(object(payload, requestId), requestId);
		const media = this.mediaSummary(file);
		if (file.ownerId !== ownerId || !media) throw new OwuiError('not_found', 404, requestId);
		return media;
	}

	async openMediaContent(
		id: string,
		ownerId: string,
		disposition: 'preview' | 'download' = 'preview',
		range?: string,
		signal?: AbortSignal
	): Promise<Response> {
		const media = await this.getOwnedMedia(id, ownerId, signal);
		if (range !== undefined && !/^bytes=(?:\d+-\d*|\d*-\d+)$/.test(range))
			throw new TypeError('range must contain one valid byte range');
		const suffix = disposition === 'download' ? '?attachment=true' : '';
		const response = await this.response(
			`api/v1/files/${encodeURIComponent(id)}/content${suffix}`,
			{ headers: { accept: '*/*', ...(range ? { range } : {}) }, signal }
		);
		const headers = new Headers();
		for (const [name, value] of response.headers) {
			if (
				MEDIA_RESPONSE_HEADERS.has(name.toLowerCase()) &&
				!['content-disposition', 'content-type'].includes(name.toLowerCase())
			)
				headers.set(name, value);
		}
		headers.set('content-type', this.safeMediaContentType(media));
		headers.set('content-disposition', this.contentDisposition(disposition, media.filename));
		headers.set('content-security-policy', "default-src 'none'; sandbox");
		headers.set('x-content-type-options', 'nosniff');
		return new Response(response.body, { status: response.status, headers });
	}

	async listKnowledge(page = 1): Promise<OwuiPage<OwuiKnowledgeSummary>> {
		this.page(page);
		const { payload, requestId } = await this.request(`api/v1/knowledge/?page=${page}`);
		const root = object(payload, requestId);
		return {
			items: array(root.items, requestId).map((entry) => {
				const k = object(entry, requestId);
				return {
					id: string(k.id, requestId),
					name: string(k.name, requestId),
					description: string(k.description, requestId),
					writeAccess: k.write_access === true,
					createdAt: number(k.created_at, requestId),
					updatedAt: number(k.updated_at, requestId)
				};
			}),
			total: number(root.total, requestId),
			page
		};
	}

	async createChat(modelId: string, title = 'New chat'): Promise<OwuiChat> {
		if (!modelId) throw new TypeError('modelId is required');
		const { payload, requestId } = await this.request('api/v1/chats/new', {
			method: 'POST',
			body: {
				chat: { title, models: [modelId], messages: [], history: { messages: {}, currentId: null } }
			}
		});
		const chat = object(payload, requestId);
		return {
			id: string(chat.id, requestId),
			title: string(chat.title, requestId),
			updatedAt: number(chat.updated_at, requestId)
		};
	}

	async resolveImages(
		fileIds: string[],
		ownerId: string,
		signal?: AbortSignal
	): Promise<FlowImages> {
		const value = { kind: 'images', fileIds };
		if (!isFlowImages(value)) throw new TypeError('Choose 1-8 image files');
		for (const id of fileIds) {
			const media = await this.getOwnedMedia(id, ownerId, signal);
			if (
				media.mediaType !== 'image' ||
				!['image/png', 'image/jpeg', 'image/webp'].includes(media.contentType ?? '')
			)
				throw new TypeError('Choose PNG, JPEG or WebP images');
		}
		return { kind: 'images', fileIds: [...fileIds] };
	}

	async uploadFlowImage(file: File, ownerId: string, signal?: AbortSignal): Promise<FlowImages> {
		if (
			file.size === 0 ||
			file.size > 10 * 1024 * 1024 ||
			!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
		)
			throw new TypeError('Choose a PNG, JPEG or WebP image up to 10 MB');
		const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
		const valid =
			file.type === 'image/png'
				? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
				: file.type === 'image/jpeg'
					? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
					: String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
						String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
		if (!valid) throw new TypeError('Image contents do not match its format');
		const formData = new FormData();
		const extension =
			file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : 'webp';
		formData.append('file', file, `flow-image.${extension}`);
		const { payload, requestId } = await this.request('api/v1/files/?process=false', {
			method: 'POST',
			formData,
			signal,
			timeoutMs: 60_000
		});
		const id = string(object(payload, requestId).id, requestId);
		return this.resolveImages([id], ownerId, signal);
	}

	async createImages(
		input: FlowImageNodeV1['config'] & { fileIds: string[]; ownerId: string; signal?: AbortSignal }
	): Promise<FlowImages> {
		if (!input.prompt.trim())
			throw new OwuiError('image_prompt_required', 400, this.nextRequestId());
		if (input.prompt.length > 32768) throw new TypeError('Enter an image prompt');
		if (input.operation !== 'generate' && input.operation !== 'edit')
			throw new TypeError('Invalid image operation');
		if (input.size && !['1024x1024', '1536x1024', '1024x1536'].includes(input.size))
			throw new TypeError('Invalid image size');
		if (input.operation === 'edit')
			await this.resolveImages(input.fileIds, input.ownerId, input.signal);
		else if (input.fileIds.length)
			throw new TypeError('Generation does not accept reference images');
		const { payload, requestId } = await this.request(
			input.operation === 'edit' ? 'api/v1/images/edit' : 'api/v1/images/generations',
			{
				method: 'POST',
				signal: input.signal,
				timeoutMs: 300_000,
				body: {
					prompt: input.prompt,
					n: 1,
					...(input.size ? { size: input.size } : {}),
					...(input.operation === 'edit' ? { image: input.fileIds } : {})
				}
			}
		).catch((error: unknown) => {
			if (error instanceof OwuiError && error.code === 'permission_denied')
				throw new OwuiError('image_access_denied', error.status, error.requestId);
			throw error;
		});
		const fileIds = array(payload, requestId).map((entry) => {
			const path = string(object(entry, requestId).url, requestId);
			const match = /^\/api\/v1\/files\/([A-Za-z0-9_-]{1,128})\/content$/.exec(path);
			if (!match) throw new OwuiError('invalid_response', 502, requestId);
			return match[1];
		});
		return this.resolveImages(fileIds, input.ownerId, input.signal);
	}

	async completeText(input: OwuiTextCompletionRequest): Promise<OwuiTextCompletion> {
		if (
			!input.modelId ||
			input.modelId.trim() !== input.modelId ||
			input.modelId.length > 256 ||
			input.modelId.includes('://')
		)
			throw new TypeError('modelId must be a valid opaque model identifier');
		if (!input.prompt.trim() || input.prompt.length > 32 * 1024)
			throw new TypeError('prompt must contain 1-32768 characters');
		if (
			input.temperature !== undefined &&
			(!Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 2)
		)
			throw new TypeError('temperature must be between 0 and 2');
		if (
			input.maxTokens !== undefined &&
			(!Number.isInteger(input.maxTokens) || input.maxTokens < 1 || input.maxTokens > 32_768)
		)
			throw new TypeError('maxTokens must be an integer from 1 to 32768');

		const [models, workspaceModels, functions] = await Promise.all([
			this.listModels(input.signal),
			this.listWorkspaceModels(input.signal),
			this.listFunctions(input.signal)
		]);
		const model = models.find((candidate) => candidate.id === input.modelId);
		if (
			!model ||
			model.kind !== 'model' ||
			workspaceModels.some((candidate) => candidate.id === input.modelId) ||
			functions.some((candidate) => candidate.id === input.modelId)
		)
			throw new OwuiError('not_found', 404, this.nextRequestId());

		const params = {
			...(input.temperature === undefined ? {} : { temperature: input.temperature }),
			...(input.maxTokens === undefined ? {} : { max_tokens: input.maxTokens })
		};
		// Omitting parent_id, chat_id, user_message, and session_id selects the pinned v0.10.2
		// direct API path. Adding parent_id: null would invoke OWUI chat-management behavior.
		const { response, requestId } = await this.responseWithId('api/chat/completions', {
			method: 'POST',
			headers: { accept: 'text/event-stream' },
			body: {
				model: input.modelId,
				messages: [{ role: 'user', content: input.prompt }],
				stream: true,
				...(Object.keys(params).length === 0 ? {} : { params })
			},
			signal: input.signal
		});
		const content = await this.readCompletionStream(response, requestId, input.signal);
		if (!content.trim() || content.length > TEXT_COMPLETION_MAX_CONTENT_LENGTH)
			throw new OwuiError('invalid_response', 502, requestId);
		return { modelId: input.modelId, content, requestId };
	}

	private async readCompletionStream(
		response: Response,
		requestId: string,
		callerSignal?: AbortSignal
	): Promise<string> {
		if (!response.body) throw new OwuiError('invalid_response', 502, requestId);
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';
		let content = '';
		let bytes = 0;
		let finished = false;
		const consumeLine = (rawLine: string) => {
			const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
			if (!line.startsWith('data:')) return;
			const data = line.slice(5).trimStart();
			if (data === '[DONE]') {
				finished = true;
				return;
			}
			if (finished || data === '') return;
			let payload: unknown;
			try {
				payload = JSON.parse(data);
			} catch (error) {
				throw new OwuiError('invalid_response', 502, requestId, { cause: error });
			}
			const root = object(payload, requestId);
			const choices = array(root.choices, requestId);
			if (choices.length === 0) return;
			if (choices.length !== 1) throw new OwuiError('invalid_response', 502, requestId);
			const choice = object(choices[0], requestId);
			const delta = object(choice.delta, requestId);
			if (delta.content === undefined || delta.content === null) return;
			content += string(delta.content, requestId);
			if (content.length > TEXT_COMPLETION_MAX_CONTENT_LENGTH)
				throw new OwuiError('invalid_response', 502, requestId);
		};

		try {
			while (!finished) {
				const { value, done } = await reader.read();
				if (done) break;
				bytes += value.byteLength;
				if (bytes > TEXT_COMPLETION_MAX_STREAM_BYTES)
					throw new OwuiError('invalid_response', 502, requestId);
				buffer += decoder.decode(value, { stream: true });
				let newline = buffer.indexOf('\n');
				while (newline >= 0) {
					consumeLine(buffer.slice(0, newline));
					buffer = buffer.slice(newline + 1);
					newline = buffer.indexOf('\n');
				}
				if (buffer.length > TEXT_COMPLETION_MAX_STREAM_BYTES)
					throw new OwuiError('invalid_response', 502, requestId);
			}
			buffer += decoder.decode();
			if (buffer) consumeLine(buffer);
			if (!finished) throw new OwuiError('invalid_response', 502, requestId);
			return content;
		} catch (error) {
			if (error instanceof OwuiError) throw error;
			if (callerSignal?.aborted) throw callerSignal.reason;
			if (
				error instanceof DOMException &&
				(error.name === 'TimeoutError' || error.name === 'AbortError')
			)
				throw new OwuiError('timeout', 504, requestId, { cause: error });
			throw new OwuiError('upstream_unavailable', 503, requestId, { cause: error });
		} finally {
			await reader.cancel().catch(() => {});
			reader.releaseLock();
		}
	}

	private user(value: JsonObject, requestId: string): StudioUser {
		const role = string(value.role, requestId);
		if (role !== 'user' && role !== 'admin')
			throw new OwuiError('invalid_response', 502, requestId);
		return {
			id: string(value.id, requestId),
			email: string(value.email, requestId),
			name: string(value.name, requestId),
			role: role as StudioUserRole,
			profileImageUrl: nullableString(value.profile_image_url, requestId)
		};
	}

	private async request(path: string, options: RequestOptions = {}) {
		const { response, requestId } = await this.responseWithId(path, options);
		try {
			return { payload: (await response.json()) as unknown, requestId };
		} catch (error) {
			throw new OwuiError('invalid_response', 502, requestId, { cause: error });
		}
	}

	private async response(path: string, options: RequestOptions = {}) {
		return (await this.responseWithId(path, options)).response;
	}

	private async responseWithId(path: string, options: RequestOptions = {}) {
		const requestId = this.nextRequestId();
		const method = options.method ?? 'GET';
		const authenticated = options.authenticated ?? true;
		if (authenticated && !this.options.token)
			throw new OwuiError('authentication_required', 401, requestId);
		const attempts = (options.idempotent ?? method === 'GET') ? 2 : 1;
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			try {
				const headers = new Headers({ accept: 'application/json', 'x-request-id': requestId });
				for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
				if (authenticated) headers.set('authorization', `Bearer ${this.options.token}`);
				if (options.body !== undefined) headers.set('content-type', 'application/json');
				const response = await this.fetcher(new URL(path, this.baseUrl), {
					method,
					headers,
					body:
						options.formData ??
						(options.body === undefined ? undefined : JSON.stringify(options.body)),
					redirect: 'error',
					signal: options.signal
						? AbortSignal.any([
								options.signal,
								AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs)
							])
						: AbortSignal.timeout(options.timeoutMs ?? this.timeoutMs)
				});
				if (!response.ok) {
					if (attempt < attempts && [502, 503, 504].includes(response.status)) continue;
					throw new OwuiError(mapOwuiStatus(response.status), response.status, requestId);
				}
				return { response, requestId };
			} catch (error) {
				if (error instanceof OwuiError) throw error;
				if (options.signal?.aborted) throw error;
				if (attempt < attempts) continue;
				if (
					error instanceof DOMException &&
					(error.name === 'TimeoutError' || error.name === 'AbortError')
				)
					throw new OwuiError('timeout', 504, requestId, { cause: error });
				throw new OwuiError('upstream_unavailable', 503, requestId, { cause: error });
			}
		}
		throw new OwuiError('upstream_unavailable', 503, requestId);
	}

	private fileSummary(file: JsonObject, requestId: string): OwuiFileSummary {
		const meta = this.optionalObject(file.meta);
		return {
			id: string(file.id, requestId),
			ownerId: string(file.user_id, requestId),
			filename: string(file.filename, requestId),
			contentType: nullableString(meta?.content_type, requestId),
			size: nullableNumber(meta?.size, requestId),
			createdAt: number(file.created_at, requestId),
			updatedAt: nullableNumber(file.updated_at, requestId)
		};
	}

	private mediaSummary(file: OwuiFileSummary): StudioMediaSummary | null {
		const mediaType = this.mediaType(file.contentType, file.filename);
		if (!mediaType) return null;
		return {
			id: file.id,
			filename: file.filename,
			mediaType,
			contentType: file.contentType,
			size: file.size,
			createdAt: file.createdAt,
			updatedAt: file.updatedAt
		};
	}

	private mediaType(contentType: string | null, filename: string): StudioMediaType | null {
		const mimeType = contentType?.toLowerCase().split(';', 1)[0].trim() ?? '';
		if (mimeType === 'image/svg+xml') return null;
		const mimeMedia = (['image', 'video', 'audio'] as const).find((type) =>
			mimeType.startsWith(`${type}/`)
		);
		const extension = filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
		const extensionMedia = (['image', 'video', 'audio'] as const).find(
			(type) => extension !== undefined && MEDIA_EXTENSIONS[type].has(extension)
		);
		if (mimeMedia && extensionMedia && mimeMedia !== extensionMedia) return null;
		if (mimeMedia) return mimeMedia;
		if (mimeType) return null;
		return extensionMedia ?? null;
	}

	private cursor(value: string | null, mode: 'list' | 'search'): number {
		if (value === null) return 0;
		if (value.length > 256) throw new TypeError('invalid cursor');
		try {
			const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
			const cursor = object(parsed, 'cursor');
			if (
				cursor.mode !== mode ||
				!Number.isSafeInteger(cursor.position) ||
				Number(cursor.position) < 0
			)
				throw new TypeError('invalid cursor');
			return Number(cursor.position);
		} catch (error) {
			if (error instanceof TypeError) throw error;
			throw new TypeError('invalid cursor', { cause: error });
		}
	}

	private encodeCursor(mode: 'list' | 'search', position: number): string {
		return Buffer.from(JSON.stringify({ mode, position }), 'utf8').toString('base64url');
	}

	private owner(ownerId: string) {
		if (!ownerId) throw new TypeError('ownerId is required');
	}

	private limit(limit: number) {
		if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50)
			throw new TypeError('limit must be an integer from 1 to 50');
	}

	private safeMediaContentType(media: StudioMediaSummary): string {
		if (media.contentType) return media.contentType.toLowerCase().split(';', 1)[0].trim();
		const extension = media.filename.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
		const fallbacks: Record<string, string> = {
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			gif: 'image/gif',
			webp: 'image/webp',
			bmp: 'image/bmp',
			tif: 'image/tiff',
			tiff: 'image/tiff',
			mp4: 'video/mp4',
			mov: 'video/quicktime',
			webm: 'video/webm',
			avi: 'video/x-msvideo',
			mkv: 'video/x-matroska',
			m4v: 'video/x-m4v',
			ogv: 'video/ogg',
			mp3: 'audio/mpeg',
			wav: 'audio/wav',
			m4a: 'audio/mp4',
			ogg: 'audio/ogg',
			flac: 'audio/flac',
			aac: 'audio/aac',
			opus: 'audio/opus'
		};
		return fallbacks[extension] ?? 'application/octet-stream';
	}

	private contentDisposition(disposition: 'preview' | 'download', filename: string): string {
		const encoded = encodeURIComponent(filename).replace(
			/[!'()*]/g,
			(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
		);
		return `${disposition === 'download' ? 'attachment' : 'inline'}; filename*=UTF-8''${encoded}`;
	}
	private optionalObject(value: unknown): JsonObject | null {
		return typeof value === 'object' && value !== null && !Array.isArray(value)
			? (value as JsonObject)
			: null;
	}
	private page(page: number) {
		if (!Number.isSafeInteger(page) || page < 1)
			throw new TypeError('page must be a positive integer');
	}
}
