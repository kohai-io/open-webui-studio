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
		const flow = getServices().flows.get(locals.session.owuiUserId, params.id);
		return flow
			? flowJson(flow, locals.requestId)
			: flowErrorResponse(new FlowStoreError('not_found'), locals.requestId);
	} catch (error) {
		return flowErrorResponse(error, locals.requestId);
	}
};

export const PUT: RequestHandler = async ({ locals, params, request, url }) => {
	if (!locals.session) return authenticationRequired(locals.requestId);
	try {
		assertSameOrigin(request, url);
		const body = await readFlowBody(request, [
			'expectedRevision',
			'name',
			'description',
			'definition'
		]);
		return flowJson(
			getServices().flows.update(locals.session.owuiUserId, params.id, {
				expectedRevision: body.expectedRevision as number,
				name: body.name,
				description: body.description,
				definition: body.definition
			}),
			locals.requestId
		);
	} catch (error) {
		return flowErrorResponse(error, locals.requestId);
	}
};

export const DELETE: RequestHandler = ({ locals, params, request, url }) => {
	if (!locals.session) return authenticationRequired(locals.requestId);
	try {
		assertSameOrigin(request, url);
		getServices().flows.delete(locals.session.owuiUserId, params.id);
		return new Response(null, {
			status: 204,
			headers: { 'cache-control': 'private, no-store', 'x-request-id': locals.requestId }
		});
	} catch (error) {
		return flowErrorResponse(error, locals.requestId);
	}
};
