import type { RequestHandler } from './$types';
import { getServices } from '$lib/server/services';
import { authenticationRequired, flowErrorResponse, flowJson } from '$lib/server/flows/http';
import { FlowExecutionError } from '$lib/server/flows/executions';

export const GET: RequestHandler = ({ locals, params }) => {
	if (!locals.session) return authenticationRequired(locals.requestId);
	try {
		const execution = getServices().flowExecutions.get(locals.session.owuiUserId, params.id);
		return execution
			? flowJson(execution, locals.requestId)
			: flowErrorResponse(new FlowExecutionError('not_found'), locals.requestId);
	} catch (error) {
		return flowErrorResponse(error, locals.requestId);
	}
};
