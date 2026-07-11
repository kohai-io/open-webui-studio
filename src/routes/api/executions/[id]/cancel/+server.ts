import type { RequestHandler } from './$types';
import { getServices } from '$lib/server/services';
import {
	assertSameOrigin,
	authenticationRequired,
	flowErrorResponse,
	flowJson
} from '$lib/server/flows/http';

export const POST: RequestHandler = ({ locals, params, request, url }) => {
	if (!locals.session) return authenticationRequired(locals.requestId);
	try {
		assertSameOrigin(request, url);
		return flowJson(
			getServices().flowExecutions.requestCancel(locals.session.owuiUserId, params.id),
			locals.requestId,
			202
		);
	} catch (error) {
		return flowErrorResponse(error, locals.requestId);
	}
};
