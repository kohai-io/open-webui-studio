import type { Handle } from '@sveltejs/kit';
import { normaliseRequestId } from '$lib/server/request-id';
import { getServices } from '$lib/server/services';

export const handle: Handle = async ({ event, resolve }) => {
	const startedAt = performance.now();
	const requestId = normaliseRequestId(event.request.headers.get('x-request-id'));

	event.locals.requestId = requestId;
	event.locals.session = null;
	const sessionHandle = event.cookies.get('studio_session');
	if (sessionHandle) {
		try {
			event.locals.session = getServices().sessions.get(sessionHandle);
		} catch {
			event.locals.session = null;
		}
		if (!event.locals.session) event.cookies.delete('studio_session', { path: '/studio' });
	}
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
