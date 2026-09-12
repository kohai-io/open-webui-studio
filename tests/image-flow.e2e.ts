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
	await page.getByRole('button', { name: 'Create flow', exact: true }).click();
	await expect(page.getByText('Flow created.', { exact: true })).toBeVisible();
	await page.getByLabel('prompt', { exact: true }).fill('A lighthouse at dusk');
	await page.getByRole('button', { name: 'Run flow', exact: true }).click();
	await expect(page.locator('.result img')).toHaveCount(1);
	await expect(page.locator('.result img')).toBeVisible();
	await expect(page.locator('[data-testid="flow-canvas"] img')).toHaveCount(2);
	expect(calls.at(-1)?.body).toEqual({ prompt: 'A lighthouse at dusk', n: 1 });
	await page.reload();
	await page
		.getByRole('button', { name: /succeeded/ })
		.first()
		.click();
	await expect(page.locator('.result img')).toBeVisible();
	await expect(page.getByLabel('prompt', { exact: true })).toHaveValue('A lighthouse at dusk');
	await page.screenshot({ path: 'data/flow-image-preview.png', fullPage: true });
	expect(errors).toEqual([]);
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
	await expect(page.locator('.result img')).toBeVisible();
	const imageCall = calls.at(-1)!;
	expect(imageCall.path).toBe('/api/v1/images/edit');
	expect(imageCall.body.image).toHaveLength(3);
	const ids = imageCall.body.image as string[];
	expect(ids[1]).toBe('reference-b');
	expect(files.get(ids[2])!.bytes.length).toBeGreaterThan(500);
	await page.getByLabel('prompt', { exact: true }).fill('fail test');
	const previous = calls.length;
	await page.getByRole('button', { name: 'Run flow', exact: true }).click();
	await expect(page.getByText(/Run ended with upstream unavailable/)).toBeVisible();
	expect(calls.length).toBe(previous + 1);
	await expect(page.getByAltText('Selected reference')).toHaveCount(3);
	await page.reload();
	await page
		.getByRole('button', { name: /failed/ })
		.first()
		.click();
	await expect(page.getByAltText('Selected reference')).toHaveCount(3);
});
