import type { RequestHandler } from './$types';
import { getServices } from '$lib/server/services';
import { flowEventStream, parseEventCursor } from '$lib/server/flows/event-stream';
import { authenticationRequired, flowErrorResponse } from '$lib/server/flows/http';
import { FlowExecutionError } from '$lib/server/flows/executions';

export const GET: RequestHandler = ({ locals, params, request, url }) => {
	if (!locals.session) return authenticationRequired(locals.requestId);
	try {
		const services = getServices();
		if (!services.flowExecutions.get(locals.session.owuiUserId, params.id))
			return flowErrorResponse(new FlowExecutionError('not_found'), locals.requestId);
		const after = parseEventCursor(
			request.headers.get('last-event-id') ?? url.searchParams.get('after')
		);
		return new Response(
			flowEventStream(
				services.flowExecutions,
				locals.session.owuiUserId,
				params.id,
				after,
				request.signal
			),
			{
				headers: {
					'cache-control': 'private, no-store',
					connection: 'keep-alive',
					'content-type': 'text/event-stream; charset=utf-8',
					'x-accel-buffering': 'no',
					'x-request-id': locals.requestId
				}
			}
		);
	} catch (error) {
		return flowErrorResponse(error, locals.requestId);
	}
};
