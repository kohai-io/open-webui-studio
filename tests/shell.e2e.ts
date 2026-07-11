import { expect, test } from '@playwright/test';

test('serves the signed-out Welcome and Agents states plus health under the base path', async ({
	page,
	request
}) => {
	await page.goto('./');
	await expect(
		page.getByRole('heading', { level: 1, name: 'Your work, given room.' })
	).toBeVisible();
	await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

	await page.goto('./agents');
	await expect(page.getByRole('heading', { level: 1, name: 'Agents & models' })).toBeVisible();
	await expect(page.getByText('Please sign in to view your catalogue.')).toBeVisible();

	const health = await request.get('./health');
	expect(health.ok()).toBeTruthy();
	expect(await health.json()).toMatchObject({ status: 'ok', service: 'open-webui-studio' });
	expect(health.headers()['x-request-id']).toBeTruthy();
});
