import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { openStudioDatabase } from '../src/lib/server/database/database';
import { encryptJson } from '../src/lib/server/sessions/crypto';
import { emptyShot } from '../src/lib/director/types';
const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
	'base64'
);
const files = new Map<string, { type: string; bytes: Buffer }>();
const tasks = new Map<
	string,
	{ fileId: string; polls: number; failed: boolean; providerTaskId: string }
>();
const submissions: Record<string, unknown>[] = [];
let server: Server;
let session: string;
const metadata = (id: string) => ({
	id,
	user_id: 'director-user',
	filename: id + (files.get(id)!.type === 'video/mp4' ? '.mp4' : '.png'),
	created_at: 100,
	updated_at: 100,
	meta: { content_type: files.get(id)!.type, size: files.get(id)!.bytes.length }
});
test.beforeAll(async () => {
	const db = openStudioDatabase(process.env.DIRECTOR_E2E_DB!);
	session = randomBytes(32).toString('base64url');
	const now = Date.now();
	db.prepare(
		'INSERT INTO studio_session (id_hash,encrypted_payload,expires_at,idle_expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?)'
	).run(
		createHash('sha256').update(session).digest('hex'),
		encryptJson(
			{
				issuer: 'https://identity.test',
				subject: 'director-user',
				owuiUserId: 'director-user',
				owuiToken: 'fixture-token',
				owuiTokenExpiresAt: null
			},
			Buffer.from(process.env.DIRECTOR_E2E_KEY!, 'base64')
		),
		now + 3600000,
		now + 3600000,
		now,
		now
	);
	db.close();
	server = createServer(async (req, res) => {
		const path = new URL(req.url!, 'http://localhost').pathname;
		const json = (body: unknown, status = 200) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		const stream = (body: unknown) => {
			res.writeHead(200, { 'content-type': 'text/event-stream' });
			res.end(
				`data: ${JSON.stringify({ choices: [{ delta: { content: typeof body === 'string' ? body : JSON.stringify(body) } }] })}\n\ndata: [DONE]\n\n`
			);
		};
		if (req.headers.authorization !== 'Bearer fixture-token') return json({}, 401);
		if (path === '/api/v1/auths/')
			return json({
				id: 'director-user',
				email: 'director@example.test',
				name: 'Director',
				role: 'user',
				profile_image_url: null
			});
		if (path === '/api/config') return json({ features: { enable_image_generation: true } });
		if (path === '/api/v1/users/permissions') return json({ features: { image_generation: true } });
		if (path === '/api/models')
			return json({
				data: [
					{ id: 'text-model', name: 'Planning model' },
					{ id: 'runway', name: 'Runway Seedance' }
				]
			});
		if (path === '/api/v1/models/list') return json({ items: [], total: 0 });
		if (path === '/api/v1/functions/') return json([{ id: 'runway', is_active: true }]);
		if (path === '/api/v1/files/' && req.method === 'GET')
			return json({ items: [...files.keys()].map(metadata), total: files.size });
		if (path === '/api/chat/completions' || path.startsWith('/api/v1/images/')) {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			const body = JSON.parse(Buffer.concat(chunks).toString());
			if (path.startsWith('/api/v1/images/')) {
				const id = randomUUID();
				files.set(id, { type: 'image/png', bytes: png });
				return json([{ url: `/api/v1/files/${id}/content` }]);
			}
			if (body.model === 'text-model')
				return stream({
					shots: ['Arrival', 'The signal', 'Departure'].map((title) => ({
						title,
						action: 'Maya waits at a station.',
						camera: 'Slow push in',
						setting: 'Platform at dusk',
						dialogue: 'Maya: We made it.',
						sound: 'Train ambience',
						duration: 5
					}))
				});
			const command = JSON.parse(body.messages[0].content).studio_director;
			if (command.operation === 'capabilities')
				return stream({ protocol: 1, enabled: true, firstFrame: true, lastFrame: false });
			if (command.operation === 'submit') {
				submissions.push(command);
				const id = randomUUID();
				files.set(id, {
					type: 'video/mp4',
					bytes: Buffer.from('000000186674797069736F6D0000020069736F6D69736F32', 'hex')
				});
				const providerTaskId = randomUUID();
				tasks.set(command.jobId, {
					fileId: id,
					polls: 0,
					failed: command.prompt.includes('Moderation test fixture'),
					providerTaskId
				});
				return stream({ jobId: command.jobId, state: 'running', providerTaskId });
			}
			const task = tasks.get(command.jobId);
			if (!task) return stream({ error: 'not_found' });
			task.polls++;
			if (task.failed)
				return stream({
					jobId: command.jobId,
					state: 'failed',
					providerTaskId: task.providerTaskId,
					failureCode: 'INPUT_PREPROCESSING.SAFETY.THIRD_PARTY'
				});
			return stream({
				jobId: command.jobId,
				state: task.polls < 2 ? 'running' : 'succeeded',
				providerTaskId: task.providerTaskId,
				fileIds: task.polls < 2 ? [] : [task.fileId]
			});
		}
		const match = /^\/api\/v1\/files\/([^/]+)(\/content)?$/.exec(path);
		if (match && files.has(match[1])) {
			if (match[2]) {
				res.writeHead(200, { 'content-type': files.get(match[1])!.type });
				res.end(files.get(match[1])!.bytes);
				return;
			}
			return json(metadata(match[1]));
		}
		return json({}, 404);
	});
	await new Promise<void>((resolve) => server.listen(18918, '127.0.0.1', resolve));
});
test.afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});
test.beforeEach(async ({ context }) => {
	await context.addCookies([
		{
			name: 'studio_session',
			value: session,
			domain: '127.0.0.1',
			path: '/studio',
			httpOnly: true,
			sameSite: 'Lax'
		}
	]);
});

test('three-shot production with references, reload, selective retake and export', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await page.goto('./director');
	await page.getByLabel('Project name').fill('The last train');
	await page.getByRole('button', { name: '+ New project', exact: true }).click();
	await page.getByRole('tab', { name: 'Brief', exact: true }).click();
	await page
		.getByLabel('Brief', { exact: true })
		.fill('A three-shot TV scene: Maya waits for the last train.');
	await page.getByLabel('Planning model').selectOption('text-model');
	await page.getByLabel('Video pipe').selectOption('runway');
	await page.getByRole('button', { name: 'Save project', exact: true }).click();
	await page.getByRole('tab', { name: 'References', exact: true }).click();
	await page.getByRole('button', { name: '+ Add reference' }).click();
	await page.getByLabel('Reference name').fill('Maya');
	await page.getByLabel('Description', { exact: true }).fill('Short dark hair, navy coat.');
	await page.getByRole('button', { name: 'Generate reference', exact: true }).click();
	await page.getByRole('tab', { name: 'Takes', exact: true }).click();
	await page.getByRole('button', { name: 'Use this result', exact: true }).click();
	await page.getByRole('tab', { name: 'Assistant', exact: true }).click();
	await page.getByRole('button', { name: 'Draft storyboard', exact: true }).click();
	await page.getByRole('button', { name: 'Apply proposal', exact: true }).click();
	for (const title of ['Arrival', 'The signal', 'Departure']) {
		await page.getByRole('tab', { name: /Storyboard/ }).click();
		await page
			.locator('.shot-list')
			.getByRole('button', { name: new RegExp(title) })
			.click();
		await page.getByLabel('Maya', { exact: true }).check();
		await page.getByRole('button', { name: 'Generate first frame', exact: true }).click();
		await page.getByRole('tab', { name: 'Takes', exact: true }).click();
		const frame = page
			.locator('article.take')
			.filter({ has: page.locator('.pill', { hasText: 'first-frame' }) })
			.first();
		await frame.getByRole('button', { name: 'Use this result', exact: true }).click();
		await expect(frame.getByText('Shot direction has changed since this take.')).toHaveCount(0);
		await page.getByRole('tab', { name: /Storyboard/ }).click();
		await page.getByRole('button', { name: 'Generate video + audio', exact: true }).click();
		if (title === 'Arrival') await page.reload();
		await page.getByRole('tab', { name: 'Takes', exact: true }).click();
		const take = page
			.locator('article.take')
			.filter({ has: page.locator('.pill', { hasText: 'video' }) })
			.first();
		await expect(take.locator('video')).toBeVisible({ timeout: 30000 });
		await take.getByRole('button', { name: 'Use this result', exact: true }).click();
	}
	expect(submissions).toHaveLength(3);
	await page.getByRole('tab', { name: /Storyboard/ }).click();
	await page
		.locator('.shot-list')
		.getByRole('button', { name: /The signal/ })
		.click();
	await page.getByLabel('Camera and framing').fill('A closer, still composition');
	await page.getByRole('button', { name: 'Generate video + audio', exact: true }).click();
	await page.getByRole('tab', { name: 'Takes', exact: true }).click();
	const retake = page
		.locator('article.take')
		.filter({ has: page.locator('.pill', { hasText: 'video' }) })
		.first();
	await expect(retake.locator('video')).toBeVisible({ timeout: 30000 });
	await retake.getByRole('button', { name: 'Use this result', exact: true }).click();
	expect(submissions).toHaveLength(4);
	expect(submissions[3].prompt).toContain('closer, still');
	await page.getByRole('tab', { name: 'Sequence', exact: true }).click();
	await expect(page.getByText('3/3 shots accepted')).toBeVisible();
	const downloaded = page.waitForEvent('download');
	await page.getByRole('link', { name: 'Export production bundle' }).click();
	const download = await downloaded;
	await download.saveAs('data/director-production-test.zip');
	expect(await download.failure()).toBeNull();
	await page.getByRole('tab', { name: /Storyboard/ }).click();
	await page.screenshot({ path: 'data/director-workspace.png', fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	await page.screenshot({ path: 'data/director-mobile.png', fullPage: true });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	expect(errors).toEqual([]);
});

test('moderation failure explains the result and retains provider details after reload', async ({
	page
}) => {
	const created = await page.request.post('/studio/api/director', {
		data: { name: 'Provider failure test' }
	});
	const project = await created.json();
	project.videoModelId = 'runway';
	project.shots = [
		{ ...emptyShot(randomUUID()), title: 'Blocked test', action: 'Moderation test fixture' }
	];
	const saved = await page.request.post(`/studio/api/director/${project.id}`, {
		data: { operation: 'save', revision: project.revision, document: project }
	});
	expect(saved.ok()).toBe(true);
	await page.goto(`./director/${project.id}`);
	const before = submissions.length;
	await page.getByRole('button', { name: 'Generate video + audio', exact: true }).click();
	await page.getByRole('tab', { name: 'Takes', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Blocked by provider moderation', {
		timeout: 30000
	});
	const providerTaskId = tasks.get(String(submissions.at(-1)!.jobId))!.providerTaskId;
	await page.reload();
	await page.getByRole('tab', { name: 'Takes', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('Blocked by provider moderation');
	await page.getByText('Provider details', { exact: true }).click();
	await expect(page.getByText(providerTaskId, { exact: true })).toBeVisible();
	await expect(
		page.getByText('INPUT_PREPROCESSING.SAFETY.THIRD_PARTY', { exact: true })
	).toBeVisible();
	await expect(page.getByText('0 active jobs', { exact: false })).toBeVisible();
	expect(submissions.length - before).toBe(1);
	expect(
		await page.locator('article.take').evaluate((card) => card.scrollWidth <= card.clientWidth)
	).toBe(true);
	await page.screenshot({ path: 'data/director-failure-diagnostics.png', fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page.locator('article.take').evaluate((card) => card.scrollWidth <= card.clientWidth)
	).toBe(true);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
});

test('API rejects another owner and stale revisions, without generation', async ({ page }) => {
	const result = await page.request.post('/studio/api/director', {
		data: { name: 'Ownership test' }
	});
	expect(result.status()).toBe(201);
	const project = await result.json();
	const stale = await page.request.post(`/studio/api/director/${project.id}`, {
		data: { operation: 'save', revision: 0, document: project }
	});
	expect(stale.status()).toBe(409);
	const crossOrigin = await page.request.post(`/studio/api/director/${project.id}`, {
		headers: { origin: 'https://elsewhere.test' },
		data: { operation: 'undo', revision: 1 }
	});
	expect(crossOrigin.status()).toBe(403);
	const unauthorized = await page.request.get(`/studio/api/director/${project.id}`, {
		headers: { cookie: '' }
	});
	expect(unauthorized.status()).toBe(401);
});
