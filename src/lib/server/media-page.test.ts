import { describe, expect, it } from 'vitest';
import { loadMedia, publicMediaError } from './media-page';
import { OwuiClient } from './owui/client';
import { OwuiError } from './owui/errors';
import { createOwuiStub, stubClientOptions } from './owui/stub';

describe('Media page service', () => {
	it('loads only self-owned media and supports filename search', async () => {
		const stub = createOwuiStub({
			userId: 'admin-a',
			role: 'admin',
			files: [
				{ id: 'owned', userId: 'admin-a', filename: 'launch.mp4', contentType: 'video/mp4' },
				{ id: 'other', userId: 'user-b', filename: 'launch-secret.mp4', contentType: 'video/mp4' },
				{ id: 'document', userId: 'admin-a', filename: 'launch.txt', contentType: 'text/plain' }
			]
		});
		const client = new OwuiClient({ ...stubClientOptions(stub.fetch), token: 'admin-token' });

		await expect(loadMedia(client, 'admin-a', '', null)).resolves.toEqual({
			items: [expect.objectContaining({ id: 'owned', mediaType: 'video' })],
			nextCursor: null
		});
		await expect(loadMedia(client, 'admin-a', 'launch', null)).resolves.toEqual({
			items: [expect.objectContaining({ id: 'owned', mediaType: 'video' })],
			nextCursor: null
		});
	});

	it('maps hidden resources without exposing upstream details', () => {
		expect(publicMediaError(new OwuiError('not_found', 404, 'request-1'))).toBe(
			'permission_denied'
		);
		expect(publicMediaError(new OwuiError('upstream_unavailable', 503, 'request-2'))).toBe(
			'upstream_unavailable'
		);
	});
});
