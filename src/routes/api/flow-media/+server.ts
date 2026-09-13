import type { RequestHandler } from './$types';
import { getServices } from '$lib/server/services';
import {
	authenticationRequired,
	assertSameOrigin,
	flowJson,
	flowErrorResponse
} from '$lib/server/flows/http';
import { OwuiError } from '$lib/server/owui/errors';

export const GET: RequestHandler = async ({ locals, url, request }) => {
	if (!locals.session) return authenticationRequired(locals.requestId);
	try {
		const page = await getServices()
			.owuiForToken(locals.session.owuiToken)
			.listMedia(locals.session.owuiUserId, url.searchParams.get('cursor'), 24, request.signal);
		return flowJson(
			{
				...page,
				items: page.items.filter(
					(item) =>
						item.mediaType === 'image' &&
						['image/png', 'image/jpeg', 'image/webp'].includes(item.contentType ?? '')
				)
			},
			locals.requestId
		);
	} catch (error) {
		return mediaError(error, locals.requestId);
	}
};
export const POST: RequestHandler = async ({ locals, request, url }) => {
	if (!locals.session) return authenticationRequired(locals.requestId);
	try {
		assertSameOrigin(request, url);
		// Bound the stream before parsing multipart data, including requests without Content-Length.
		const reader = request.body?.getReader();
		if (!reader) throw new TypeError('Missing image');
		const chunks: Uint8Array[] = [];
		let size = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				size += value.byteLength;
				if (size > 11 * 1024 * 1024) {
					await reader.cancel();
					throw new TypeError('Image too large');
				}
				chunks.push(value);
			}
		} finally {
			reader.releaseLock();
		}
		const body = Buffer.concat(chunks);
		const form = await new Response(body, {
			headers: { 'content-type': request.headers.get('content-type') ?? '' }
		}).formData();
		const file = form.get('file');
		if (!(file instanceof File)) throw new TypeError('Missing image');
		const result = await getServices()
			.owuiForToken(locals.session.owuiToken)
			.uploadFlowImage(file, locals.session.owuiUserId, request.signal);
		return flowJson(result, locals.requestId, 201);
	} catch (error) {
		return mediaError(error, locals.requestId);
	}
};
function mediaError(error: unknown, requestId: string) {
	if (error instanceof OwuiError) return flowJson({ error: error.code }, requestId, error.status);
	if (error instanceof TypeError) return flowJson({ error: 'validation_failed' }, requestId, 400);
	return flowErrorResponse(error, requestId);
}
