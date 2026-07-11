import type { RequestHandler } from './$types';
import { getServices } from '$lib/server/services';
import {
	assertSameOrigin,
	authenticationRequired,
	flowErrorResponse,
	flowJson,
	readFlowBody
} from '$lib/server/flows/http';

export const GET: RequestHandler = ({ locals }) => {
	if (!locals.session) return authenticationRequired(locals.requestId);
	try {
		return flowJson(
			{ items: getServices().flows.list(locals.session.owuiUserId) },
			locals.requestId
		);
	} catch (error) {
		return flowErrorResponse(error, locals.requestId);
	}
};

export const POST: RequestHandler = async ({ locals, request, url }) => {
	if (!locals.session) return authenticationRequired(locals.requestId);
	try {
		assertSameOrigin(request, url);
		const body = await readFlowBody(request, ['name', 'description', 'definition']);
		const flow = getServices().flows.create(locals.session.owuiUserId, {
			name: body.name,
			description: body.description,
			definition: body.definition
		});
		return flowJson(flow, locals.requestId, 201);
	} catch (error) {
		return flowErrorResponse(error, locals.requestId);
	}
};
