import type { RequestHandler } from './$types';
import { getServices } from '$lib/server/services';
import { authenticationRequired, flowErrorResponse, flowJson } from '$lib/server/flows/http';

export const GET: RequestHandler = ({ locals, params }) => {
	if (!locals.session) return authenticationRequired(locals.requestId);
	try {
		return flowJson(
			{ items: getServices().flows.listVersions(locals.session.owuiUserId, params.id) },
			locals.requestId
		);
	} catch (error) {
		return flowErrorResponse(error, locals.requestId);
	}
};
