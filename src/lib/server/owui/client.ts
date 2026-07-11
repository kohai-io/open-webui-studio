import { randomUUID } from 'node:crypto';
import type {
	OwuiChat,
	OwuiFileSummary,
	OwuiKnowledgeSummary,
	OwuiModel,
	OwuiFunction,
	OwuiWorkspaceModel,
	OwuiPage,
	OwuiSession,
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
	method?: 'GET' | 'POST' | 'DELETE';
	body?: unknown;
	authenticated?: boolean;
	idempotent?: boolean;
}

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
			expiresAt: nullableNumber(value.expires_at, requestId)
		};
	}

	async getCurrentUser(): Promise<StudioUser> {
		const { payload, requestId } = await this.request('api/v1/auths/');
		return this.user(object(payload, requestId), requestId);
	}

	async listModels(): Promise<OwuiModel[]> {
		const { payload, requestId } = await this.request('api/models');
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

	async listWorkspaceModels(): Promise<OwuiWorkspaceModel[]> {
		const items: OwuiWorkspaceModel[] = [];
		for (let page = 1; ; page += 1) {
			const { payload, requestId } = await this.request(`api/v1/models/list?page=${page}`);
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

	async listFunctions(): Promise<OwuiFunction[]> {
		const { payload, requestId } = await this.request('api/v1/functions/');
		return array(payload, requestId).map((entry) => {
			const fn = object(entry, requestId);
			return { id: string(fn.id, requestId), isActive: fn.is_active === true };
		});
	}

	async listFiles(page = 1): Promise<OwuiPage<OwuiFileSummary>> {
		this.page(page);
		const { payload, requestId } = await this.request(`api/v1/files/?page=${page}&content=false`);
		const root = object(payload, requestId);
		return {
			items: array(root.items, requestId).map((entry) => {
				const file = object(entry, requestId);
				const meta = this.optionalObject(file.meta);
				return {
					id: string(file.id, requestId),
					filename: string(file.filename, requestId),
					contentType: nullableString(meta?.content_type, requestId),
					size: nullableNumber(meta?.size, requestId),
					createdAt: number(file.created_at, requestId),
					updatedAt: nullableNumber(file.updated_at, requestId)
				};
			}),
			total: number(root.total, requestId),
			page
		};
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
		const requestId = this.nextRequestId();
		const method = options.method ?? 'GET';
		const authenticated = options.authenticated ?? true;
		if (authenticated && !this.options.token)
			throw new OwuiError('authentication_required', 401, requestId);
		const attempts = (options.idempotent ?? method === 'GET') ? 2 : 1;
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			try {
				const headers = new Headers({ accept: 'application/json', 'x-request-id': requestId });
				if (authenticated) headers.set('authorization', `Bearer ${this.options.token}`);
				if (options.body !== undefined) headers.set('content-type', 'application/json');
				const response = await this.fetcher(new URL(path, this.baseUrl), {
					method,
					headers,
					body: options.body === undefined ? undefined : JSON.stringify(options.body),
					signal: AbortSignal.timeout(this.timeoutMs)
				});
				if (!response.ok) {
					if (attempt < attempts && [502, 503, 504].includes(response.status)) continue;
					throw new OwuiError(mapOwuiStatus(response.status), response.status, requestId);
				}
				return { payload: (await response.json()) as unknown, requestId };
			} catch (error) {
				if (error instanceof OwuiError) throw error;
				if (attempt < attempts) continue;
				throw new OwuiError('upstream_unavailable', 503, requestId, { cause: error });
			}
		}
		throw new OwuiError('upstream_unavailable', 503, requestId);
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
