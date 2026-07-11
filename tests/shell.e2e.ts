import { expect, test } from '@playwright/test';

test('serves the Studio shell and health endpoint under the base path', async ({
	page,
	request
}) => {
	await page.goto('./');
	await expect(page.getByRole('heading', { level: 1, name: 'Studio' })).toBeVisible();

	const health = await request.get('./health');
	expect(health.ok()).toBeTruthy();
	expect(await health.json()).toMatchObject({ status: 'ok', service: 'open-webui-studio' });
	expect(health.headers()['x-request-id']).toBeTruthy();
});
