import { describe, expect, it } from 'vitest';
import { OwuiClient } from './client';
import { createOwuiStub, stubClientOptions } from './stub';

describe('OwuiClient.completeText', () => {
	it('uses the direct non-persisted streaming v0.10.2 completion contract', async () => {
		const stub = createOwuiStub();
		const client = new OwuiClient({
			...stubClientOptions(stub.fetch),
			token: 'user-token',
			requestId: sequence('request')
		});

		await expect(
			client.completeText({
				modelId: 'model-a',
				prompt: 'Summarise this text',
				temperature: 0.2,
				maxTokens: 512
			})
		).resolves.toMatchObject({ modelId: 'model-a', content: 'Completed text' });

		const completions = requestsFor(stub.requests, '/api/chat/completions');
		expect(completions).toHaveLength(1);
		expect(completions[0].method).toBe('POST');
		expect(completions[0].headers.get('authorization')).toBe('Bearer user-token');
		expect(await completions[0].json()).toEqual({
			model: 'model-a',
			messages: [{ role: 'user', content: 'Summarise this text' }],
			stream: true,
			params: { temperature: 0.2, max_tokens: 512 }
		});
		expect(stub.requests.some((request) => new URL(request.url).pathname.includes('/chats'))).toBe(
			false
		);
	});

	it('rejects inaccessible agents and function-backed models before dispatch', async () => {
		const agentStub = createOwuiStub();
		const agentClient = new OwuiClient({
			...stubClientOptions(agentStub.fetch),
			token: 'user-token'
		});
		await expect(
			agentClient.completeText({ modelId: 'assistant-a', prompt: 'Hello' })
		).rejects.toMatchObject({ code: 'not_found', status: 404 });
		expect(requestsFor(agentStub.requests, '/api/chat/completions')).toHaveLength(0);

		const functionStub = createOwuiStub();
		const functionFetch: typeof globalThis.fetch = async (input, init) => {
			const path = new URL(input instanceof Request ? input.url : input).pathname;
			if (path.endsWith('/api/v1/functions/'))
				return Response.json([{ id: 'model-a', is_active: true }]);
			return functionStub.fetch(input, init);
		};
		const functionClient = new OwuiClient({
			...stubClientOptions(functionFetch),
			token: 'user-token'
		});
		await expect(
			functionClient.completeText({ modelId: 'model-a', prompt: 'Hello' })
		).rejects.toMatchObject({ code: 'not_found', status: 404 });
		expect(requestsFor(functionStub.requests, '/api/chat/completions')).toHaveLength(0);
	});

	it('rejects invalid request fields before making an upstream call', async () => {
		const stub = createOwuiStub();
		const client = new OwuiClient({ ...stubClientOptions(stub.fetch), token: 'user-token' });
		await expect(
			client.completeText({ modelId: ' model-a', prompt: 'Hello' })
		).rejects.toBeInstanceOf(TypeError);
		await expect(client.completeText({ modelId: 'model-a', prompt: '   ' })).rejects.toBeInstanceOf(
			TypeError
		);
		expect(stub.requests).toHaveLength(0);
	});

	it.each([
		[429, 'rate_limited'],
		[504, 'timeout'],
		[503, 'upstream_unavailable']
	])('maps HTTP %s and dispatches the completion mutation once', async (status, code) => {
		const stub = createOwuiStub();
		let dispatches = 0;
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const path = new URL(input instanceof Request ? input.url : input).pathname;
			if (path.endsWith('/api/chat/completions')) {
				dispatches++;
				return Response.json({ detail: 'redacted' }, { status });
			}
			return stub.fetch(input, init);
		};
		const client = new OwuiClient({ ...stubClientOptions(fetch), token: 'user-token' });
		await expect(
			client.completeText({ modelId: 'model-a', prompt: 'Hello' })
		).rejects.toMatchObject({
			code,
			status
		});
		expect(dispatches).toBe(1);
	});

	it('does not retry a network failure after completion dispatch', async () => {
		const stub = createOwuiStub();
		let dispatches = 0;
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const path = new URL(input instanceof Request ? input.url : input).pathname;
			if (path.endsWith('/api/chat/completions')) {
				dispatches++;
				throw new TypeError('connection reset');
			}
			return stub.fetch(input, init);
		};
		const client = new OwuiClient({ ...stubClientOptions(fetch), token: 'user-token' });
		await expect(
			client.completeText({ modelId: 'model-a', prompt: 'Hello' })
		).rejects.toMatchObject({
			code: 'upstream_unavailable',
			status: 503
		});
		expect(dispatches).toBe(1);
	});

	it.each([
		{},
		{ choices: [] },
		{ choices: [{ delta: { content: 'one' } }, { delta: { content: 'two' } }] },
		{ choices: [{ delta: { content: { text: 'not accepted' } } }] },
		{ choices: [{ delta: { content: '' } }] },
		{ choices: [{ delta: { content: '   ' } }] },
		{ choices: [{ delta: { content: 'x'.repeat(1024 * 1024 + 1) } }] }
	])('fails closed on malformed completion response %#', async (completionResponse) => {
		const stub = createOwuiStub({ completionResponse });
		const client = new OwuiClient({ ...stubClientOptions(stub.fetch), token: 'user-token' });
		await expect(
			client.completeText({ modelId: 'model-a', prompt: 'Hello' })
		).rejects.toMatchObject({
			code: 'invalid_response',
			status: 502
		});
	});

	it('joins chunks split across transport boundaries and requires the terminal marker', async () => {
		const stub = createOwuiStub();
		const encoder = new TextEncoder();
		const fetch: typeof globalThis.fetch = async (input, init) => {
			const path = new URL(input instanceof Request ? input.url : input).pathname;
			if (!path.endsWith('/api/chat/completions')) return stub.fetch(input, init);
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hel'));
						controller.enqueue(
							encoder.encode('lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\n')
						);
						controller.enqueue(encoder.encode('data: [DONE]\n\n'));
						controller.close();
					}
				})
			);
		};
		const client = new OwuiClient({ ...stubClientOptions(fetch), token: 'user-token' });
		await expect(
			client.completeText({ modelId: 'model-a', prompt: 'Hello' })
		).resolves.toMatchObject({ content: 'Hello world' });

		const incompleteFetch: typeof globalThis.fetch = async (input, init) => {
			const path = new URL(input instanceof Request ? input.url : input).pathname;
			if (!path.endsWith('/api/chat/completions')) return stub.fetch(input, init);
			return new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
		};
		const incomplete = new OwuiClient({
			...stubClientOptions(incompleteFetch),
			token: 'user-token'
		});
		await expect(
			incomplete.completeText({ modelId: 'model-a', prompt: 'Hello' })
		).rejects.toMatchObject({ code: 'invalid_response' });
	});

	it('maps its internal deadline to timeout without retrying', async () => {
		const stub = createOwuiStub();
		let dispatches = 0;
		const fetch = hangingCompletion(stub.fetch, () => dispatches++);
		const client = new OwuiClient({
			...stubClientOptions(fetch),
			token: 'user-token',
			timeoutMs: 10
		});
		await expect(
			client.completeText({ modelId: 'model-a', prompt: 'Hello' })
		).rejects.toMatchObject({
			code: 'timeout',
			status: 504
		});
		expect(dispatches).toBe(1);
	});

	it('propagates caller cancellation without retrying or remapping it', async () => {
		const stub = createOwuiStub();
		let dispatches = 0;
		let markStarted: () => void = () => {};
		const started = new Promise<void>((resolve) => (markStarted = resolve));
		const fetch = hangingCompletion(stub.fetch, () => {
			dispatches++;
			markStarted();
		});
		const client = new OwuiClient({ ...stubClientOptions(fetch), token: 'user-token' });
		const controller = new AbortController();
		const pending = client.completeText({
			modelId: 'model-a',
			prompt: 'Hello',
			signal: controller.signal
		});
		await started;
		controller.abort();
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(dispatches).toBe(1);
	});
});

function requestsFor(requests: Request[], path: string) {
	return requests.filter((request) => new URL(request.url).pathname.endsWith(path));
}

function sequence(prefix: string) {
	let value = 0;
	return () => `${prefix}-${++value}`;
}

function hangingCompletion(
	fallback: typeof globalThis.fetch,
	onDispatch: () => void
): typeof globalThis.fetch {
	return async (input, init) => {
		const path = new URL(input instanceof Request ? input.url : input).pathname;
		if (!path.endsWith('/api/chat/completions')) return fallback(input, init);
		onDispatch();
		return await new Promise<Response>((_resolve, reject) => {
			const signal = init?.signal;
			if (!signal) throw new Error('completion request must have an abort signal');
			if (signal.aborted) reject(signal.reason);
			else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
		});
	};
}
