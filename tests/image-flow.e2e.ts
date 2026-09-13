import { test, expect } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { openStudioDatabase } from '../src/lib/server/database/database';
import { encryptJson } from '../src/lib/server/sessions/crypto';

const png = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=',
	'base64'
);
const files = new Map<string, { bytes: Buffer; type: string }>();
const calls: { path: string; body: Record<string, unknown> }[] = [];
let server: Server;
let session: string;
let generationEnabled = true;
const meta = (id: string) => ({
	id,
	user_id: 'image-user',
	filename: `${id}.png`,
	created_at: 100,
	updated_at: 100,
	meta: { content_type: files.get(id)!.type, size: files.get(id)!.bytes.length }
});
test.beforeAll(async () => {
	const db = openStudioDatabase(process.env.IMAGE_E2E_DB!);
	session = randomBytes(32).toString('base64url');
	const now = Date.now();
	db.prepare(
		'INSERT INTO studio_session (id_hash,encrypted_payload,expires_at,idle_expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?)'
	).run(
		createHash('sha256').update(session).digest('hex'),
		encryptJson(
			{
				issuer: 'https://identity.test',
				subject: 'image-user',
				owuiUserId: 'image-user',
				owuiToken: 'fixture-token',
				owuiTokenExpiresAt: null
			},
			Buffer.from(process.env.IMAGE_E2E_KEY!, 'base64')
		),
		now + 3600000,
		now + 3600000,
		now,
		now
	);
	db.close();
	files.set('reference-a', { bytes: png, type: 'image/png' });
	files.set('reference-b', { bytes: png, type: 'image/png' });
	server = createServer(async (req, res) => {
		const path = new URL(req.url!, 'http://localhost').pathname;
		const json = (body: unknown, status = 200) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		if (req.headers.authorization !== 'Bearer fixture-token')
			return json({ error: 'unauthorized' }, 401);
		if (path === '/api/v1/auths/')
			return json({
				id: 'image-user',
				email: 'image@example.test',
				name: 'Image tester',
				role: 'user',
				profile_image_url: null
			});
		if (path === '/api/config')
			return json({ features: { enable_image_generation: generationEnabled } });
		if (path === '/api/v1/users/permissions') return json({ features: { image_generation: true } });
		if (path === '/api/models') return json({ data: [{ id: 'model-a', name: 'Model A' }] });
		if (path === '/api/v1/models/list') return json({ items: [], total: 0 });
		if (path === '/api/v1/functions/') return json([]);
		if (path === '/api/v1/files/' && req.method === 'GET')
			return json({ items: [...files.keys()].map(meta), total: files.size });
		if (path === '/api/v1/files/' && req.method === 'POST') {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			const form = await new Response(Buffer.concat(chunks), {
				headers: { 'content-type': req.headers['content-type']! }
			}).formData();
			const file = form.get('file') as File;
			const id = `upload-${randomUUID()}`;
			files.set(id, { bytes: Buffer.from(await file.arrayBuffer()), type: file.type });
			return json({ id });
		}
		if (path.startsWith('/api/v1/images/')) {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(Buffer.from(chunk));
			const body = JSON.parse(Buffer.concat(chunks).toString());
			calls.push({ path, body });
			if (String(body.prompt).includes('access denied test'))
				return json({ detail: 'Access prohibited' }, 403);
			if (String(body.prompt).includes('fail test')) return json({ error: 'fixture failure' }, 400);
			const id = `result-${randomUUID()}`;
			files.set(id, { bytes: png, type: 'image/png' });
			return json([{ url: `/api/v1/files/${id}/content` }]);
		}
		const match = /^\/api\/v1\/files\/([^/]+)(\/content)?$/.exec(path);
		if (match && files.has(match[1])) {
			if (match[2]) {
				res.writeHead(200, { 'content-type': files.get(match[1])!.type });
				res.end(files.get(match[1])!.bytes);
				return;
			}
			return json(meta(match[1]));
		}
		return json({ error: 'not found' }, 404);
	});
	await new Promise<void>((resolve) => server.listen(18917, '127.0.0.1', resolve));
});
test.afterAll(async () => {
	await new Promise<void>((resolve) => server.close(() => resolve()));
});
test.beforeEach(async ({ context }) => {
	generationEnabled = true;
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

test('creates and runs an image flow, renders results on canvas, and reloads history', async ({
	page
}) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('./flows');
	await page.getByRole('button', { name: 'New image flow', exact: true }).click();
	await page.getByLabel('Flow name', { exact: true }).fill('Browser image generation');
	await page.getByRole('group', { name: 'Input node', exact: true }).click();
	await page.getByLabel('Default value', { exact: true }).fill('A lighthouse at dusk');
	await page.getByRole('button', { name: 'Create flow', exact: true }).click();
	await expect(page.getByText('Flow created.', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Run flow', exact: true }).click();
	await expect(page.locator('.result img')).toHaveCount(1);
	await expect(page.locator('.result > .images:not(.compact) img')).toBeVisible();
	await expect(page.locator('[data-testid="flow-canvas"] img')).toHaveCount(2);
	expect(calls.at(-1)?.body).toEqual({ prompt: 'A lighthouse at dusk', n: 1 });
	await page.reload();
	await page.getByRole('button', { name: 'History', exact: true }).click();
	await page
		.getByRole('button', { name: /succeeded/ })
		.first()
		.click();
	await expect(page.locator('.result > .images:not(.compact) img')).toBeVisible();
	await page.getByRole('button', { name: 'Inputs', exact: true }).click();
	await expect(page.getByLabel('prompt', { exact: true })).toHaveValue('A lighthouse at dusk');
	await page.screenshot({ path: 'data/flow-image-preview.png', fullPage: true });
	expect(errors).toEqual([]);
});

test('explains denied image access on the canvas and in the run result', async ({ page }) => {
	await page.goto('./flows');
	await page.getByRole('button', { name: 'New image flow', exact: true }).click();
	await page.getByLabel('Flow name', { exact: true }).fill('Denied image access');
	await page.getByRole('button', { name: 'Create flow', exact: true }).click();
	await expect(page.getByText('Flow created.', { exact: true })).toBeVisible();
	await page.getByLabel('prompt', { exact: true }).fill('access denied test');
	const before = calls.length;
	await page.getByRole('button', { name: 'Run flow', exact: true }).click();
	await expect(
		page.getByText(
			'Open WebUI denied image generation or editing. Check Admin Settings > Images and your account permissions.',
			{ exact: true }
		)
	).toHaveCount(2);
	expect(calls.length - before).toBe(1);
	await page.getByRole('button', { name: 'Inputs', exact: true }).click();
	await expect(page.getByLabel('prompt', { exact: true })).toHaveValue('access denied test');
});

test('combines uploaded, library and drawn references without flattening; failed runs retain them', async ({
	page
}) => {
	await page.goto('./flows');
	await page.getByRole('button', { name: 'New image edit flow', exact: true }).click();
	await page.getByLabel('Flow name', { exact: true }).fill('Browser image editing');
	await page.getByRole('button', { name: 'Create flow', exact: true }).click();
	await expect(page.getByText('Flow created.', { exact: true })).toBeVisible();
	await page
		.getByLabel('prompt', { exact: true })
		.fill('Combine the subjects and follow the sketch');
	await page
		.locator('input[type=file]')
		.setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: png });
	await expect(page.getByAltText('Selected reference')).toHaveCount(1);
	await page.getByRole('button', { name: 'Choose from Media' }).click();
	await page.getByRole('button', { name: 'reference-b.png' }).click();
	await page.getByRole('button', { name: 'Close Media picker' }).click();
	await page.getByRole('button', { name: 'Draw a sketch' }).click();
	const canvas = page.getByLabel('Sketch drawing area');
	await canvas.scrollIntoViewIfNeeded();
	const box = (await canvas.boundingBox())!;
	await page.mouse.move(box.x + 50, box.y + 50);
	await page.mouse.down();
	await page.mouse.move(box.x + 150, box.y + 130, { steps: 8 });
	await page.mouse.up();
	await page.getByRole('button', { name: 'Use sketch as reference' }).click();
	await expect(page.getByAltText('Selected reference')).toHaveCount(3);
	await page.getByRole('button', { name: 'Run flow', exact: true }).click();
	await expect(page.locator('.result > .images:not(.compact) img')).toBeVisible();
	const imageCall = calls.at(-1)!;
	expect(imageCall.path).toBe('/api/v1/images/edit');
	expect(imageCall.body.image).toHaveLength(3);
	const ids = imageCall.body.image as string[];
	expect(ids[1]).toBe('reference-b');
	expect(files.get(ids[2])!.bytes.length).toBeGreaterThan(500);
	await page.getByRole('button', { name: 'Inputs', exact: true }).click();
	await page.getByLabel('prompt', { exact: true }).fill('fail test');
	const previous = calls.length;
	await page.getByRole('button', { name: 'Run flow', exact: true }).click();
	await expect(
		page
			.getByRole('region', { name: 'Run this flow' })
			.getByText(/Run ended with upstream unavailable/)
	).toBeVisible();
	expect(calls.length).toBe(previous + 1);
	await page.getByRole('button', { name: 'Inputs', exact: true }).click();
	await expect(page.getByAltText('Selected reference')).toHaveCount(3);
	await page.reload();
	await page.getByRole('button', { name: 'History', exact: true }).click();
	await page
		.getByRole('button', { name: /failed/ })
		.first()
		.click();
	await page.getByRole('button', { name: 'Inputs', exact: true }).click();
	await expect(page.getByAltText('Selected reference')).toHaveCount(3);
});

test('saves the latest draft, previews results, adds edit steps and reuses an output', async ({
	page
}) => {
	await page.goto('./flows');
	await page.getByRole('button', { name: 'New image flow', exact: true }).click();
	await page.getByLabel('Flow name', { exact: true }).fill('Image workshop');
	await page.getByLabel('prompt', { exact: true }).fill('A lighthouse at dusk');
	await page.getByRole('button', { name: 'Save and run', exact: true }).click();
	await expect(page.locator('.result > .images:not(.compact) img')).toBeVisible();
	await page
		.getByRole('group', { name: 'Image node', exact: true })
		.getByText('Generate image', { exact: true })
		.click();
	await page
		.getByLabel('Prompt template', { exact: false })
		.fill('Watercolour: {{node.input.output}}');
	await expect(page.getByRole('button', { name: 'Save and run', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Save and run', exact: true }).click();
	await expect(page.locator('.result > .images:not(.compact) img')).toBeVisible();
	expect(calls.at(-1)?.body.prompt).toBe('Watercolour: A lighthouse at dusk');
	await expect(page.getByText(/Flow version 2/)).toBeVisible();
	await page.locator('.result').getByRole('button', { name: 'Preview generated image' }).click();
	await expect(page.getByRole('dialog', { name: 'Image preview' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(page.getByRole('dialog', { name: 'Image preview' })).not.toBeVisible();
	await expect(
		page.locator('.result').getByRole('link', { name: 'Download', exact: true })
	).toHaveAttribute('href', /download=1/);
	await page.screenshot({ path: 'data/flow-workspace-desktop.png', fullPage: true });
	await page.getByRole('button', { name: 'Add edit step', exact: true }).click();
	await expect(page.getByRole('combobox', { name: /^Operation/ })).toHaveValue('edit');
	await page.screenshot({ path: 'data/flow-workspace-settings.png', fullPage: true });
	await page.getByLabel('Prompt template', { exact: false }).fill('Make the sky blue');
	const before = calls.length;
	await page.getByRole('button', { name: 'Save and run', exact: true }).click();
	await expect(page.locator('.result > .images:not(.compact) img')).toBeVisible();
	expect(calls.length - before).toBe(2);
	expect(calls.at(-1)?.path).toBe('/api/v1/images/edit');
	await page.getByRole('button', { name: 'Use as reference', exact: true }).click();
	await expect(page.getByLabel('Flow name', { exact: true })).toHaveValue('Edit generated image');
	await expect(page.getByAltText('Selected reference')).toHaveCount(1);
	await page.getByLabel('prompt', { exact: true }).fill('Add a sailing boat');
	const reused = calls.length;
	await page.getByRole('button', { name: 'Save and run', exact: true }).click();
	await expect(page.locator('.result > .images:not(.compact) img')).toBeVisible();
	expect(calls.length - reused).toBe(1);
	expect(calls.at(-1)?.body.image).toHaveLength(1);
	await page.setViewportSize({ width: 390, height: 844 });
	await page.getByRole('button', { name: 'Fit View', exact: true }).click();
	await page.getByRole('button', { name: 'Inputs', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Run flow', exact: true })).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await page.screenshot({ path: 'data/flow-workspace-mobile.png', fullPage: true });
});

test('checks readiness before queuing and never runs a draft whose save fails', async ({
	page
}) => {
	generationEnabled = false;
	await page.goto('./flows');
	await page.getByRole('button', { name: 'New image flow', exact: true }).click();
	await page.getByLabel('Flow name', { exact: true }).fill('Readiness check');
	await page.getByLabel('prompt', { exact: true }).fill('A tree');
	await expect(page.getByText('Image generation is switched off in Open WebUI.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Save and run', exact: true })).toBeDisabled();
	await expect(page.getByRole('link', { name: /Open image settings/ })).toHaveCount(0);
	generationEnabled = true;
	await page.getByRole('button', { name: 'Check again', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Save and run', exact: true })).toBeEnabled();
	// Configuration changes after page load are checked again before any execution is queued.
	generationEnabled = false;
	const before = calls.length;
	await page.getByRole('button', { name: 'Save and run', exact: true }).click();
	await expect(page.getByRole('alert')).toHaveText(
		'Image generation is switched off in Open WebUI.'
	);
	expect(calls.length).toBe(before);
	generationEnabled = true;
	await page.getByRole('button', { name: 'Check again', exact: true }).click();
	await page.route('**/studio/api/flows', async (route) => {
		if (route.request().method() === 'POST')
			await route.fulfill({ status: 409, json: { error: 'conflict' } });
		else await route.continue();
	});
	await page.getByRole('button', { name: 'Save and run', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('changed elsewhere');
	expect(calls.length).toBe(before);
	await expect(page.getByLabel('prompt', { exact: true })).toHaveValue('A tree');
});

test('an unavailable image readiness service does not block a text flow', async ({ page }) => {
	await page.route('**/studio/api/flow-capabilities', (route) =>
		route.fulfill({ status: 503, json: { error: 'unavailable' } })
	);
	await page.goto('./flows');
	await page.getByRole('button', { name: 'New flow', exact: true }).click();
	await page.getByLabel('Flow name', { exact: true }).fill('Text draft');
	await page.getByLabel('request', { exact: true }).fill('Summarise this text');
	await expect(page.getByRole('button', { name: 'Save and run', exact: true })).toBeEnabled();
	await expect(page.getByLabel('Image readiness')).toHaveCount(0);
});

test('keeps the canvas stable while accessible panels and menus expand and collapse', async ({
	page
}) => {
	await page.goto('./flows');
	const canvas = page.getByTestId('flow-canvas');
	const initialBounds = await canvas.boundingBox();
	expect(initialBounds).toEqual({ x: 0, y: 0, width: 1440, height: 1100 });
	const libraryToggle = page.getByRole('button', { name: 'Flows', exact: true });
	await expect(libraryToggle).toHaveAttribute('aria-expanded', 'true');
	await page.getByRole('button', { name: 'Collapse flow library' }).click();
	await expect(libraryToggle).toBeFocused();
	await expect(page.locator('#flow-library')).toHaveAttribute('inert', '');
	await libraryToggle.press('Enter');
	await page.getByRole('button', { name: 'New image flow', exact: true }).click();
	await expect(page.getByLabel('Flow name', { exact: true })).toBeFocused();
	await page.getByLabel('Flow name', { exact: true }).fill('Canvas workspace');
	await page.getByLabel('prompt', { exact: true }).fill('A retained prompt');
	await page.getByRole('button', { name: 'Collapse flow details' }).click();
	const detailsToggle = page.getByRole('button', {
		name: 'Flow details: Canvas workspace',
		exact: true
	});
	await expect(detailsToggle).toBeFocused();
	await detailsToggle.press('Enter');
	await expect(page.getByLabel('Flow name', { exact: true })).toHaveValue('Canvas workspace');
	await page.getByLabel('Flow name', { exact: true }).press('Escape');
	await expect(detailsToggle).toBeFocused();
	await expect(detailsToggle).toHaveAttribute('aria-expanded', 'false');
	await page.getByRole('button', { name: 'Collapse run panel' }).click();
	const runToggle = page.getByRole('button', { name: 'Run panel', exact: true });
	await expect(runToggle).toBeFocused();
	await expect(runToggle).toHaveAttribute('aria-expanded', 'false');
	expect(await canvas.boundingBox()).toEqual(initialBounds);
	const transform = await page.locator('.svelte-flow__viewport').getAttribute('style');
	await page.mouse.move(700, 800);
	await page.mouse.down();
	await page.mouse.move(820, 850, { steps: 8 });
	await page.mouse.up();
	await expect(page.locator('.svelte-flow__viewport')).not.toHaveAttribute('style', transform!);
	await page.getByRole('button', { name: 'Fit View', exact: true }).click();
	await page.screenshot({ path: 'data/flow-infinite-canvas.png', fullPage: true });
	await runToggle.press('Enter');
	await expect(page.getByLabel('prompt', { exact: true })).toHaveValue('A retained prompt');
	const input = page.getByRole('group', { name: 'Input node', exact: true });
	await input.focus();
	await input.press('Enter');
	await expect(page.getByLabel('Input key', { exact: false })).toBeFocused();
	await page.keyboard.press('Escape');
	await expect(runToggle).toBeFocused();
	await page.emulateMedia({ reducedMotion: 'reduce' });
	await detailsToggle.click();
	expect(
		await page.locator('#flow-details').evaluate((el) => getComputedStyle(el).transitionDuration)
	).toBe('0s');
	await page.setViewportSize({ width: 390, height: 844 });
	await runToggle.click();
	await expect(page.locator('#flow-details')).toHaveAttribute('inert', '');
	await libraryToggle.click();
	await expect(runToggle).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('.floating-panel.is-open')).toHaveCount(1);
	const addNode = page.getByRole('button', { name: /^(Next after|Add node)/ });
	await addNode.click();
	await expect(page.getByRole('dialog', { name: /Add (after|a node)/ })).toBeVisible();
	await expect(page.getByPlaceholder('Search AI, prompt, JSON…')).toBeFocused();
	await page.getByPlaceholder('Search AI, prompt, JSON…').fill('image');
	await expect(page.getByRole('button', { name: /Image/ }).last()).toBeVisible();
	await page.screenshot({ path: 'data/flow-infinite-mobile-menu.png', fullPage: true });
	await page.keyboard.press('Escape');
	await expect(addNode).toBeFocused();
	await expect(addNode).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('.floating-panel.is-open')).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	);
	await page.getByRole('button', { name: 'Fit View', exact: true }).click();
	await page.screenshot({ path: 'data/flow-infinite-mobile.png', fullPage: true });
});

test.describe('touch canvas', () => {
	test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	test('creates a flow using one expanded panel at a time', async ({ page }) => {
		await page.goto('./flows');
		await page.getByRole('button', { name: 'Flows', exact: true }).tap();
		await page.getByRole('button', { name: 'New image flow', exact: true }).tap();
		await expect(page.locator('.floating-panel.is-open')).toHaveCount(1);
		await expect(page.getByLabel('Flow name', { exact: true })).toBeFocused();
		await page.getByLabel('Flow name', { exact: true }).fill('Touch canvas');
		await page.getByRole('button', { name: 'Create flow', exact: true }).tap();
		await expect(page.getByLabel('prompt', { exact: true })).toBeFocused();
		await page.getByLabel('prompt', { exact: true }).fill('A quiet woodland');
		await page.getByRole('button', { name: 'Run flow', exact: true }).tap();
		await expect(page.locator('.result > .images:not(.compact) img')).toBeVisible();
		await page.getByRole('button', { name: 'Collapse run panel' }).tap();
		await page.getByRole('button', { name: 'Fit View', exact: true }).tap();
		const addNode = page.getByRole('button', { name: 'Add node', exact: true });
		expect((await addNode.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await page.screenshot({
			path: 'data/flow-infinite-touch.png',
			fullPage: true,
			animations: 'disabled'
		});
	});
});
