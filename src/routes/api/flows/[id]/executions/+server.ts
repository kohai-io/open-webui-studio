import type { RequestHandler } from './$types';
import { getServices } from '$lib/server/services';
import {
	assertSameOrigin,
	authenticationRequired,
	flowErrorResponse,
	flowJson,
	readFlowBody
} from '$lib/server/flows/http';
import { FlowStoreError } from '$lib/server/flows/store';

export const GET: RequestHandler = ({ locals, params }) => {
	if (!locals.session) return authenticationRequired(locals.requestId);
	try {
		const services = getServices();
		if (!services.flows.get(locals.session.owuiUserId, params.id))
			return flowErrorResponse(new FlowStoreError('not_found'), locals.requestId);
		return flowJson(
			{
				items: services.flowExecutions
					.list(locals.session.owuiUserId)
					.filter((execution) => execution.flowId === params.id)
			},
			locals.requestId
		);
	} catch (error) {
		return flowErrorResponse(error, locals.requestId);
	}
};

export const POST: RequestHandler = async ({ locals, params, request, url }) => {
	if (!locals.session) return authenticationRequired(locals.requestId);
	try {
		assertSameOrigin(request, url);
		const body = await readFlowBody(request, ['flowVersion', 'inputs']);
		const execution = getServices().flowQueue.enqueue(locals.session, params.id, {
			idempotencyKey: request.headers.get('idempotency-key'),
			flowVersion: body.flowVersion,
			inputs: body.inputs
		});
		return flowJson(execution, locals.requestId, 202);
	} catch (error) {
		return flowErrorResponse(error, locals.requestId);
	}
};
