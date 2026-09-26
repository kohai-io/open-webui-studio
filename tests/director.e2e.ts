import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { DirectorStore } from '../src/lib/server/director/store';
import type { Job, JobKind, Project } from '../src/lib/director/types';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { openStudioDatabase } from '../src/lib/server/database/database';
import { encryptJson } from '../src/lib/server/sessions/crypto';
import { emptyShot } from '../src/lib/director/types';
const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
	'base64'
);
const previewVideo = readFileSync('tests/fixtures/director-preview.mp4');
const files = new Map<string, { type: string; bytes: Buffer; owner?: string }>();
const tasks = new Map<
	string,
	{ fileId: string; polls: number; failed: boolean; providerTaskId: string }
>();
const submissions: Record<string, unknown>[] = [];
let server: Server;
let session: string;
const metadata = (id: string) => ({
	id,
	user_id: files.get(id)?.owner ?? 'director-user',
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
		if (path === '/api/v1/files/' && req.method === 'POST') {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			const form = await new Response(Buffer.concat(chunks), {
				headers: { 'content-type': String(req.headers['content-type']) }
			}).formData();
			const file = form.get('file') as File;
			const id = randomUUID();
			files.set(id, { type: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
			return json(metadata(id));
		}
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
					bytes: previewVideo
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
				const file = files.get(match[1])!;
				const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
				const start = range ? Number(range[1]) : 0;
				const end = range?.[2]
					? Math.min(Number(range[2]), file.bytes.length - 1)
					: file.bytes.length - 1;
				if (start > end) {
					res.writeHead(416);
					res.end();
					return;
				}
				res.writeHead(range ? 206 : 200, {
					'content-type': file.type,
					'accept-ranges': 'bytes',
					'content-length': end - start + 1,
					...(range
						? { 'content-range': 'bytes ' + start + '-' + end + '/' + file.bytes.length }
						: {})
				});
				res.end(file.bytes.subarray(start, end + 1));
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
	await page.getByRole('button', { name: 'Use this frame', exact: true }).click();
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
		const frame = page.getByRole('article', { name: 'Frame 1 for ' + title, exact: true });
		await frame.getByRole('button', { name: 'Use this frame', exact: true }).click();
		await expect(frame.getByText('Shot direction has changed since this take.')).toHaveCount(0);
		await page.getByRole('tab', { name: /Storyboard/ }).click();
		await page.getByRole('button', { name: 'Generate video + audio', exact: true }).click();
		if (title === 'Arrival') await page.reload();
		await page.getByRole('tab', { name: 'Takes', exact: true }).click();
		const take = page.getByRole('article', { name: 'Take 1 for ' + title, exact: true });
		await expect(take.locator('video')).toBeVisible({ timeout: 30000 });
		await take.getByRole('button', { name: 'Accept take', exact: true }).click();
	}
	expect(submissions).toHaveLength(3);
	await page.getByRole('tab', { name: /Storyboard/ }).click();
	await page
		.locator('.shot-list')
		.getByRole('button', { name: /The signal/ })
		.click();
	await page.getByLabel('Camera and framing').fill('A closer, still composition');
	await page.getByRole('button', { name: 'Generate another take + audio', exact: true }).click();
	await page.getByRole('tab', { name: 'Takes', exact: true }).click();
	const retake = page.getByRole('article', { name: 'Take 2 for The signal', exact: true });
	await expect(retake.locator('video')).toBeVisible({ timeout: 30000 });
	await retake.getByRole('button', { name: 'Accept take', exact: true }).click();
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
	await page.getByRole('button', { name: 'Notes & details', exact: true }).click();
	await page.getByText('Provider details', { exact: true }).click();
	await expect(page.getByText(providerTaskId, { exact: true })).toBeVisible();
	await expect(
		page.getByText('INPUT_PREPROCESSING.SAFETY.THIRD_PARTY', { exact: true })
	).toBeVisible();
	await expect(page.getByText('0 active jobs', { exact: false })).toBeVisible();
	expect(submissions.length - before).toBe(1);
	expect(
		await page
			.locator('article.review-take')
			.evaluate((card) => card.scrollWidth <= card.clientWidth)
	).toBe(true);
	await page.screenshot({ path: 'data/director-failure-diagnostics.png', fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	expect(
		await page
			.locator('article.review-take')
			.evaluate((card) => card.scrollWidth <= card.clientWidth)
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

test('guards active jobs across tabs and revisions and reports connection recovery', async ({
	page
}) => {
	const created = await page.request.post('/studio/api/director', {
		data: { name: 'Generation controls' }
	});
	const project = await created.json();
	project.videoModelId = 'runway';
	project.shots = [
		{ ...emptyShot(randomUUID()), title: 'First', action: 'A still kettle' },
		{ ...emptyShot(randomUUID()), title: 'Second', action: 'A quiet kitchen' }
	];
	const saved = await page.request.post(`/studio/api/director/${project.id}`, {
		data: { operation: 'save', revision: project.revision, document: project }
	});
	const current = await saved.json();
	await page.goto(`./director/${project.id}`);
	await page
		.locator('.shot-list')
		.getByRole('button', { name: /Second/ })
		.click();
	const before = submissions.length;
	await page.getByRole('button', { name: 'Generate video + audio', exact: true }).click();
	await expect(
		page.getByRole('button', { name: 'Video generation in progress', exact: true })
	).toBeDisabled();
	const duplicate = await page.request.post(`/studio/api/director/${project.id}`, {
		headers: { 'idempotency-key': randomUUID() },
		data: {
			operation: 'queue',
			revision: current.revision,
			input: { kind: 'video', shotId: project.shots[1].id, referenceId: '', instruction: '' }
		}
	});
	expect(duplicate.status()).toBe(409);
	expect((await duplicate.json()).error).toBe('generation_in_progress');
	await page.getByRole('tab', { name: 'Takes', exact: true }).click();
	await page.reload();
	await expect(page.getByRole('tab', { name: 'Takes', exact: true })).toHaveAttribute(
		'aria-selected',
		'true'
	);
	await expect(page.getByLabel('Filter by shot')).toHaveValue(project.shots[1].id);
	await expect(page.getByText(/Last provider update/)).toBeVisible({ timeout: 15000 });
	await expect(page.getByText(/Completed · .* elapsed/)).toBeVisible({ timeout: 30000 });
	expect(submissions.length - before).toBe(1);
	await page.getByRole('tab', { name: /Storyboard/ }).click();
	await expect(
		page.getByRole('button', { name: 'Generate another take + audio', exact: true })
	).toBeEnabled();

	const endpoint = `**/api/director/${project.id}`;
	await page.route(endpoint, async (route) => {
		if (route.request().method() === 'GET')
			await route.fulfill({ status: 503, json: { error: 'offline' } });
		else await route.continue();
	});
	await expect(page.getByRole('alert')).toContainText('Connection interrupted', { timeout: 10000 });
	await expect(
		page.getByRole('button', { name: 'Generate another take + audio', exact: true })
	).toBeDisabled();
	await page.unroute(endpoint);
	await page.getByRole('button', { name: 'Check connection', exact: true }).click();
	await expect(page.getByText(/Connection interrupted\. Last successful refresh/)).toHaveCount(0);
	await expect(
		page.getByRole('button', { name: 'Generate another take + audio', exact: true })
	).toBeEnabled();
});

test('saves the exact crop preview as an owned first frame, preserves the original and submits the crop', async ({
	page
}) => {
	await page.goto('./director');
	const sourcePng = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 640;
		canvas.height = 480;
		const ctx = canvas.getContext('2d')!;
		ctx.fillStyle = '#21a179';
		ctx.fillRect(0, 0, 640, 120);
		ctx.fillStyle = '#4267d5';
		ctx.fillRect(0, 120, 640, 360);
		return canvas.toDataURL('image/png').split(',')[1];
	});
	const sourceId = randomUUID();
	files.set(sourceId, { type: 'image/png', bytes: Buffer.from(sourcePng, 'base64') });
	const created = await page.request.post('/studio/api/director', {
		data: { name: 'Crop controls' }
	});
	const project = await created.json();
	project.videoModelId = 'runway';
	project.shots = [
		{
			...emptyShot(randomUUID()),
			title: 'Framing test',
			action: 'A calm blue scene',
			firstFrame: sourceId
		}
	];
	await page.request.post(`/studio/api/director/${project.id}`, {
		data: { operation: 'save', revision: project.revision, document: project }
	});
	await page.goto(`./director/${project.id}`);
	await page.getByText('Prepare video crop', { exact: true }).click();
	await expect(page.getByText('640 × 360 pixels')).toBeVisible();
	await page.getByLabel('Vertical position', { exact: true }).press('End');
	await expect
		.poll(async () =>
			page
				.locator('canvas')
				.evaluate((canvas: HTMLCanvasElement) =>
					Array.from(canvas.getContext('2d')!.getImageData(0, 0, 1, 1).data)
				)
		)
		.toEqual([66, 103, 213, 255]);
	const preview = await page
		.locator('canvas')
		.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL('image/png').split(',')[1]);
	await page.screenshot({ path: 'data/director-crop-controls.png', fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await page.screenshot({ path: 'data/director-crop-controls-mobile.png', fullPage: true });
	await page.getByRole('button', { name: 'Use this crop', exact: true }).click();
	await expect(page.getByRole('status')).toHaveText(
		'Video crop saved. Your original frame is preserved.'
	);
	const { project: cropped } = await (
		await page.request.get(`/studio/api/director/${project.id}`)
	).json();
	const cropId = cropped.shots[0].firstFrame;
	expect(cropId).not.toBe(sourceId);
	expect(cropped.shots[0].firstFrameCrop).toEqual({
		sourceFileId: sourceId,
		ratio: '16:9',
		x: 50,
		y: 100,
		zoom: 1
	});
	expect(files.get(cropId)!.bytes.equals(Buffer.from(preview, 'base64'))).toBe(true);
	expect(files.get(sourceId)!.bytes.equals(Buffer.from(sourcePng, 'base64'))).toBe(true);
	await page.reload();
	await expect(page.getByText('Prepared 16:9 crop will be used for video.')).toBeVisible();
	const before = submissions.length;
	await page.getByRole('button', { name: 'Generate video + audio', exact: true }).click();
	await expect.poll(() => submissions.length, { timeout: 15000 }).toBe(before + 1);
	expect(submissions.at(-1)!.firstFrameFileId).toBe(cropId);
	await expect(page.getByRole('status')).toHaveText(
		'Generation complete. Review your results in Takes.',
		{ timeout: 30000 }
	);

	const foreignId = randomUUID();
	files.set(foreignId, { type: 'image/png', bytes: png, owner: 'another-user' });
	cropped.shots[0].firstFrameCrop.sourceFileId = foreignId;
	const denied = await page.request.post(`/studio/api/director/${project.id}`, {
		data: { operation: 'save', revision: cropped.revision, document: cropped }
	});
	expect([403, 404]).toContain(denied.status());
	await page.getByRole('button', { name: 'Use original frame', exact: true }).click();
	await expect(page.getByRole('status')).toHaveText('Project saved.');
	const restored = await (await page.request.get(`/studio/api/director/${project.id}`)).json();
	expect(restored.project.shots[0].firstFrame).toBe(sourceId);
	expect(restored.project.shots[0].firstFrameCrop).toBeUndefined();
});

test('reviews numbered takes, compares, filters, saves notes and returns to the right shot', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('./director');
	const framePng = await page.evaluate(() => {
		const canvas = document.createElement('canvas');
		canvas.width = 640;
		canvas.height = 360;
		const ctx = canvas.getContext('2d')!;
		const gradient = ctx.createLinearGradient(0, 0, 640, 360);
		gradient.addColorStop(0, '#2d4c69');
		gradient.addColorStop(1, '#c8a66b');
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, 640, 360);
		ctx.fillStyle = '#eac48b';
		ctx.beginPath();
		ctx.arc(435, 120, 60, 0, 2 * Math.PI);
		ctx.fill();
		return canvas.toDataURL('image/png').split(',')[1];
	});
	const db = openStudioDatabase(process.env.DIRECTOR_E2E_DB!);
	const key = Buffer.from(process.env.DIRECTOR_E2E_KEY!, 'base64');
	let time = Date.now() - 120000;
	const store = new DirectorStore(db, key, () => time);
	let project: Project = store.create('director-user', 'The morning edit');
	project.videoModelId = 'runway';
	project.references = [
		{ id: 'person', name: 'Alex', role: 'identity', fileId: '', description: '' }
	];
	project.shots = [
		{
			...emptyShot('light'),
			title: 'Morning light',
			action: 'Sunlight moves across a quiet room.'
		},
		{ ...emptyShot('garden'), title: 'Courtyard', action: 'Leaves move in the breeze.' }
	];
	project = store.save('director-user', project.id, project.revision, project);
	function seed(kind: JobKind, state: Job['state'], target = 'light', outputs = 1) {
		time += 1000;
		const queued = store.queue(
			'director-user',
			project.id,
			{
				kind,
				shotId: kind === 'reference' ? '' : target,
				referenceId: kind === 'reference' ? 'person' : '',
				projectRevision: project.revision,
				instruction: ''
			},
			randomUUID(),
			'fixture-token',
			time + 3600000
		);
		const fileIds =
			state === 'succeeded'
				? Array.from({ length: outputs }, () => {
						const id = randomUUID();
						files.set(id, {
							type: kind === 'video' ? 'video/mp4' : 'image/png',
							bytes: kind === 'video' ? previewVideo : Buffer.from(framePng, 'base64')
						});
						return id;
					})
				: [];
		const result: Job = {
			...queued,
			state,
			fileIds,
			updatedAt: time + 500,
			...(state === 'failed'
				? { failureCode: 'INPUT_PREPROCESSING.SAFETY.THIRD_PARTY', providerTaskId: randomUUID() }
				: {})
		};
		db.prepare(
			'UPDATE studio_director_job SET state=?, encrypted_payload=?, encrypted_credential=NULL, updated_at=? WHERE id=?'
		).run(state, encryptJson(result, key), result.updatedAt, result.id);
		return result;
	}
	const frame1 = seed('first-frame', 'succeeded');
	project = store.apply(
		'director-user',
		project.id,
		frame1.id,
		project.revision,
		frame1.fileIds![0]
	);
	const frame2 = seed('first-frame', 'succeeded', 'light', 2);
	const take1 = seed('video', 'succeeded');
	project = store.apply('director-user', project.id, take1.id, project.revision, take1.fileIds![0]);
	seed('video', 'failed');
	const take3 = seed('video', 'succeeded');
	const courtyardTake = seed('video', 'succeeded', 'garden');
	const reference = seed('reference', 'succeeded');
	seed('video', 'submission-unknown');
	db.close();
	const before = submissions.length;
	await page.goto('./director/' + project.id);
	await page.getByRole('button', { name: 'Review new take · Take 3', exact: true }).click();
	const current = page.getByRole('article', { name: 'Take 3 for Morning light', exact: true });
	await expect(current).toBeVisible();
	await expect(current.getByText('Clip duration: 1.00s')).toBeVisible();
	expect((await current.locator('video').boundingBox())!.width).toBeGreaterThan(700);
	await page.getByLabel('Result type').selectOption('video');
	await page.getByLabel('Result status').selectOption('failed');
	await expect(
		page.getByRole('article', { name: 'Take 2 for Morning light', exact: true })
	).toBeVisible();
	await expect(page.getByRole('alert')).toContainText('Blocked by provider moderation');
	await page.getByLabel('Result status').selectOption('attention');
	await expect(
		page.getByRole('article', { name: 'Take 4 for Morning light', exact: true })
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Resume status checks', exact: true })
	).toBeVisible();
	await page.getByLabel('Result status').selectOption('all');
	const strip = page.getByRole('group', { name: 'Result thumbnails' });
	await strip.getByRole('button', { name: /Morning light · Take 3 ·/ }).click();
	await page.getByRole('button', { name: 'Notes & details', exact: true }).click();
	await page
		.getByLabel('Review notes', { exact: true })
		.fill('Prefer the warmer light and quieter movement.');
	await strip.getByRole('button', { name: /Morning light · Take 1 ·/ }).press('Enter');
	await expect(page.getByLabel('Review notes', { exact: true })).toHaveValue('');
	await strip.getByRole('button', { name: /Morning light · Take 3 ·/ }).click();
	await expect(page.getByLabel('Review notes', { exact: true })).toHaveValue(
		'Prefer the warmer light and quieter movement.'
	);
	await page.getByRole('button', { name: 'Save review', exact: true }).click();
	await expect(page.getByRole('status')).toHaveText('Review saved.');
	await page.reload();
	await expect(current).toBeVisible();
	await expect(page.getByLabel('Result type')).toHaveValue('video');
	await page.getByRole('button', { name: 'Notes & details', exact: true }).click();
	await expect(page.getByLabel('Review notes', { exact: true })).toHaveValue(
		'Prefer the warmer light and quieter movement.'
	);
	await page.getByRole('button', { name: 'Hide notes & details', exact: true }).click();
	await expect(current.locator('video')).toHaveJSProperty('readyState', 4);
	await current.locator('video').evaluate((video: HTMLVideoElement) => {
		video.currentTime = 0.4;
	});
	await expect(current.locator('video')).toHaveJSProperty('currentTime', 0.4);
	const refreshed = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/director/' + project.id) &&
			response.request().method() === 'GET'
	);
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
	await refreshed;
	await expect(current.locator('video')).toHaveJSProperty('currentTime', 0.4);
	await current.getByRole('button', { name: 'Add to comparison', exact: true }).click();
	await strip.getByRole('button', { name: /Morning light · Take 1 ·/ }).click();
	await page.getByRole('button', { name: 'Add to comparison', exact: true }).click();
	await expect(page.locator('.review-screens video')).toHaveCount(2);
	await expect(page.getByText('2/2 selected for comparison')).toBeVisible();
	await page.screenshot({ path: 'data/director-review-comparison.png', fullPage: true });
	await page.getByRole('button', { name: 'Clear comparison', exact: true }).click();
	await strip.getByRole('button', { name: /Morning light · Take 3 ·/ }).click();
	await current.getByRole('button', { name: 'Accept take', exact: true }).click();
	await expect(current.getByRole('button', { name: 'Accepted', exact: true })).toBeDisabled();
	await expect(strip.getByRole('button', { name: /Morning light · Take 1 ·/ })).not.toHaveAttribute(
		'aria-label',
		/Accepted/
	);
	await page.getByLabel('Result status').selectOption('accepted');
	await expect(strip.getByRole('button')).toHaveCount(1);
	await expect(current).toBeVisible();
	await page.getByLabel('Result status').selectOption('all');
	await expect(current).toBeVisible();
	await page.getByRole('button', { name: 'Notes & details', exact: true }).click();
	await page.screenshot({ path: 'data/director-review-workspace.png', fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await page.screenshot({ path: 'data/director-review-mobile.png', fullPage: true });
	await page.getByRole('button', { name: 'Back to shot', exact: true }).click();
	await expect(page.getByLabel('Shot title')).toHaveValue('Morning light');
	await expect(page.getByText('0 active jobs', { exact: false })).toBeVisible();
	await page.getByRole('tab', { name: 'Takes', exact: true }).click();
	await page.getByLabel('Result type').selectOption('frames');
	await strip.getByRole('button', { name: /Morning light · Frame 2.2 ·/ }).click();
	await page.reload();
	await expect(
		page.getByRole('article', { name: 'Frame 2.2 for Morning light', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Use this frame', exact: true }).click();
	const saved = await (await page.request.get('/studio/api/director/' + project.id)).json();
	expect(saved.project.shots[0].firstFrame).toBe(frame2.fileIds![1]);
	expect(saved.project.shots[0].acceptedTakeId).toBe(take3.id);
	await page.getByLabel('Result type').selectOption('reference');
	await expect(
		page.getByRole('article', { name: 'Reference 1 for Alex', exact: true })
	).toBeVisible();
	await page.getByRole('button', { name: 'Use this frame', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Current reference', exact: true })).toBeDisabled();
	await expect(page.getByLabel('Filter by shot')).toHaveValue('');
	await page.reload();
	await expect(
		page.getByRole('article', { name: 'Reference 1 for Alex', exact: true })
	).toBeVisible();
	await page.getByLabel('Result status').selectOption('failed');
	await expect(page.getByText('No results match this view.')).toBeVisible();
	await page.getByRole('button', { name: 'Show all results', exact: true }).click();
	await expect(strip.getByRole('button', { name: /Courtyard · Take 1 ·/ })).toBeVisible();
	await strip.getByRole('button', { name: /Courtyard · Take 1 ·/ }).click();
	const courtyard = page.getByRole('article', { name: 'Take 1 for Courtyard', exact: true });
	await courtyard.getByRole('button', { name: 'Accept take', exact: true }).click();
	await expect(courtyard.getByRole('button', { name: 'Accepted', exact: true })).toBeDisabled();
	await expect(page.getByLabel('Filter by shot')).toHaveValue('');
	const accepted = await (await page.request.get('/studio/api/director/' + project.id)).json();
	expect(accepted.project.shots[1].acceptedTakeId).toBe(courtyardTake.id);
	expect(accepted.project.references[0].fileId).toBe(reference.fileIds![0]);
	await page.getByRole('tab', { name: 'Storyboard (2)', exact: true }).click();
	await expect(page.getByLabel('Shot title')).toHaveValue('Morning light');
	expect(submissions.length).toBe(before);
	expect(errors).toEqual([]);
});
