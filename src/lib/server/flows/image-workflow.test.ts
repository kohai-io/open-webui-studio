import { randomBytes } from 'node:crypto';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { imageFlowDefinition } from '$lib/flows/image';
import { isFlowImages } from '$lib/flows/types';
import { validateFlowDefinition } from './definition';
import { openStudioDatabase, type StudioDatabase } from '$lib/server/database/database';
import { FlowStore } from './store';
import { FlowExecutionStore } from './executions';
import { FlowCredentialLeaseStore } from './credential-leases';
import { FlowWorker } from './worker';
import { OwuiClient } from '$lib/server/owui/client';
import { createOwuiStub } from '$lib/server/owui/stub';

const databases: StudioDatabase[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});
function imageClient(options: { failure?: number; owner?: string; resultUrl?: string } = {}) {
	const requests: Request[] = [];
	const stub = createOwuiStub({
		role: 'admin',
		files: ['ref-a', 'ref-b', 'result-a'].map((id) => ({
			id,
			userId: options.owner ?? 'user-a',
			filename: `${id}.png`,
			contentType: 'image/png'
		}))
	});
	const fetcher: typeof fetch = async (input, init) => {
		const request = new Request(input, init);
		requests.push(request.clone());
		if (new URL(request.url).pathname.startsWith('/api/v1/images/'))
			return options.failure
				? new Response(null, { status: options.failure })
				: Response.json([{ url: options.resultUrl ?? '/api/v1/files/result-a/content' }]);
		return stub.fetch(request);
	};
	return {
		client: new OwuiClient({ baseUrl: 'https://owui.test', token: 'test-token', fetch: fetcher }),
		requests
	};
}
function setup(
	operation: 'generate' | 'edit',
	client: OwuiClient,
	inputs: unknown,
	definition = imageFlowDefinition(operation),
	imageNodeTimeoutMs = 300000
) {
	const database = openStudioDatabase(':memory:');
	databases.push(database);
	const encryptionKey = randomBytes(32);
	const flows = new FlowStore(database);
	const executions = new FlowExecutionStore({ database, encryptionKey });
	const credentialLeases = new FlowCredentialLeaseStore({ database, encryptionKey });
	const flow = flows.create('user-a', {
		name: 'Images',
		definition
	});
	const execution = executions.create('user-a', flow.id, { idempotencyKey: 'image-test', inputs });
	credentialLeases.issue('user-a', execution.id, {
		owuiToken: 'test-token',
		owuiTokenExpiresAt: null
	});
	const worker = new FlowWorker({
		workerId: 'image-test',
		imageNodeTimeoutMs,
		executions,
		credentialLeases,
		clientForToken: () => client
	});
	return { executions, execution, worker };
}
describe('image workflows', () => {
	it('feeds a generated image into a subsequent edit and preserves both checkpoints', async () => {
		const { client, requests } = imageClient();
		const def = imageFlowDefinition('generate');
		def.nodes.push({
			id: 'edit',
			type: 'image',
			position: { x: 480, y: 0 },
			config: { operation: 'edit', prompt: 'Make the sky blue' }
		});
		def.edges = def.edges.filter((edge) => edge.target !== 'output');
		def.edges.push(
			{ id: 'image-edit', source: 'image', target: 'edit' },
			{ id: 'edit-output', source: 'edit', target: 'output' }
		);
		const h = setup('generate', client, { prompt: 'A lighthouse' }, def);
		expect(await h.worker.runOnce()).toMatchObject({ status: 'succeeded' });
		const sent = requests.filter((r) => r.method === 'POST');
		expect(sent).toHaveLength(2);
		expect(await sent[1].json()).toEqual({
			prompt: 'Make the sky blue',
			n: 1,
			image: ['result-a']
		});
		expect(
			h.executions
				.get('user-a', h.execution.id)
				?.nodes.filter((n) => n.nodeType === 'image')
				.every((n) => isFlowImages(n.payload))
		).toBe(true);
	});
	it('applies the image deadline and aborts an in-flight call without retrying', async () => {
		const { client } = imageClient();
		let signal: AbortSignal | undefined;
		const dispatch = vi.spyOn(client, 'createImages').mockImplementation((input) => {
			signal = input.signal;
			return new Promise(() => {});
		});
		const h = setup('generate', client, { prompt: 'A tree' }, imageFlowDefinition('generate'), 5);
		expect(await h.worker.runOnce()).toMatchObject({ status: 'failed', errorCode: 'timeout' });
		expect(dispatch).toHaveBeenCalledTimes(1);
		expect(signal?.aborted).toBe(true);
	});

	it.each(['generate', 'edit'] as const)('validates the %s starter', (operation) => {
		expect(validateFlowDefinition(imageFlowDefinition(operation))).toEqual(
			imageFlowDefinition(operation)
		);
	});
	it('runs generation and stores image references in checkpoints and history', async () => {
		const { client, requests } = imageClient();
		const h = setup('generate', client, { prompt: 'Draw a lighthouse' });
		expect(await h.worker.runOnce()).toMatchObject({ status: 'succeeded' });
		const run = h.executions.get('user-a', h.execution.id)!;
		expect(run.output).toEqual({ kind: 'images', fileIds: ['result-a'] });
		expect(run.nodes.find((n) => n.nodeId === 'image')?.payload).toEqual(run.output);
		expect(h.executions.get('other-user', h.execution.id)).toBeNull();
		const sent = requests.filter((r) => r.method === 'POST');
		expect(sent).toHaveLength(1);
		expect(await sent[0].json()).toEqual({ prompt: 'Draw a lighthouse', n: 1 });
		expect(JSON.stringify(h.executions.events('user-a', h.execution.id))).not.toContain('result-a');
	});
	it('sends multiple references separately and retains them in the run', async () => {
		const { client, requests } = imageClient();
		const images = { kind: 'images', fileIds: ['ref-a', 'ref-b'] };
		const h = setup('edit', client, { prompt: 'Combine these subjects', images });
		expect(await h.worker.runOnce()).toMatchObject({ status: 'succeeded' });
		expect(
			await requests.find((r) => new URL(r.url).pathname === '/api/v1/images/edit')!.json()
		).toEqual({ prompt: 'Combine these subjects', n: 1, image: ['ref-a', 'ref-b'] });
		expect(h.executions.get('user-a', h.execution.id)?.inputs.images).toEqual(images);
	});
	it('rejects references owned by someone else before dispatch even for an admin', async () => {
		const { client, requests } = imageClient({ owner: 'other-user' });
		const h = setup('edit', client, {
			prompt: 'Edit',
			images: { kind: 'images', fileIds: ['ref-a'] }
		});
		expect(await h.worker.runOnce()).toMatchObject({
			status: 'failed',
			errorCode: 'dependency_not_found'
		});
		expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0);
	});
	it('does not retry failed generation and preserves inputs', async () => {
		const { client, requests } = imageClient({ failure: 503 });
		const h = setup('generate', client, { prompt: 'A retained prompt' });
		expect(await h.worker.runOnce()).toMatchObject({ status: 'failed' });
		expect(requests.filter((r) => r.method === 'POST')).toHaveLength(1);
		expect(h.executions.get('user-a', h.execution.id)?.inputs).toEqual({
			prompt: 'A retained prompt'
		});
	});
	it('rejects external result URLs without fetching them', async () => {
		const { client, requests } = imageClient({ resultUrl: 'https://untrusted.test/image.png' });
		await expect(
			client.createImages({
				operation: 'generate',
				prompt: 'A tree',
				fileIds: [],
				ownerId: 'user-a'
			})
		).rejects.toMatchObject({ code: 'invalid_response' });
		expect(requests.every((r) => new URL(r.url).hostname === 'owui.test')).toBe(true);
	});
	it('rejects media references in text templates and incompatible output connections', () => {
		const def = imageFlowDefinition('edit');
		const image = def.nodes.find((n) => n.type === 'image')!;
		image.config.prompt = '{{node.references.output}}';
		expect(() => validateFlowDefinition(def)).toThrow();
		const badOutput = imageFlowDefinition('generate');
		badOutput.nodes[2] = {
			id: 'output',
			type: 'output',
			position: { x: 0, y: 0 },
			config: { format: 'text' }
		};
		expect(() => validateFlowDefinition(badOutput)).toThrow();
	});
	it('rejects missing references, URLs and oversized reference lists', () => {
		expect(isFlowImages({ kind: 'images', fileIds: [] })).toBe(false);
		expect(isFlowImages({ kind: 'images', fileIds: ['https://example.com/a.png'] })).toBe(false);
		expect(
			isFlowImages({ kind: 'images', fileIds: Array.from({ length: 9 }, (_, i) => `file-${i}`) })
		).toBe(false);
		const def = imageFlowDefinition('edit');
		def.edges = def.edges.filter((e) => e.source !== 'references');
		expect(() => validateFlowDefinition(def)).toThrow();
	});
	it('uploads multipart bytes without document processing and checks the returned file owner', async () => {
		const stub = createOwuiStub({
			files: [
				{ id: 'upload-a', userId: 'user-a', filename: 'sketch.png', contentType: 'image/png' }
			]
		});
		let upload: Request | undefined;
		const client = new OwuiClient({
			baseUrl: 'https://owui.test',
			token: 'test-token',
			fetch: async (input, init) => {
				const r = new Request(input, init);
				if (r.method === 'POST') {
					upload = r;
					return Response.json({ id: 'upload-a' });
				}
				return stub.fetch(r);
			}
		});
		const bytes = Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
			'base64'
		);
		expect(
			await client.uploadFlowImage(new File([bytes], 'sketch.png', { type: 'image/png' }), 'user-a')
		).toEqual({ kind: 'images', fileIds: ['upload-a'] });
		expect(upload!.url).toContain('process=false');
		expect(upload!.headers.get('content-type')).toContain('multipart/form-data');
		const form = await upload!.formData();
		expect(await (form.get('file') as File).arrayBuffer()).toEqual(
			bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
		);
	});
});
