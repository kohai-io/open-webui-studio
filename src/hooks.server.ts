import type { Handle } from '@sveltejs/kit';
import { normaliseRequestId } from '$lib/server/request-id';

export const handle: Handle = async ({ event, resolve }) => {
	const startedAt = performance.now();
	const requestId = normaliseRequestId(event.request.headers.get('x-request-id'));

	event.locals.requestId = requestId;
	const response = await resolve(event);
	response.headers.set('x-request-id', requestId);

	console.info(
		JSON.stringify({
			event: 'http_request',
			requestId,
			method: event.request.method,
			path: event.url.pathname,
			status: response.status,
			durationMs: Math.round(performance.now() - startedAt)
		})
	);

	return response;
};
