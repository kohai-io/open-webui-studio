import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { emptyProject } from '$lib/director/types';
import { getServices } from '$lib/server/services';
import { requireDirector, directorError } from '$lib/server/director/http';
import { assertSameOrigin, flowJson, readFlowBody } from '$lib/server/flows/http';
export const GET: RequestHandler = ({ locals }) => {
	try {
		const s = requireDirector(locals);
		return flowJson({ items: getServices().director.list(s.owuiUserId) }, locals.requestId);
	} catch (e) {
		return directorError(e, locals.requestId);
	}
};
export const POST: RequestHandler = async ({ locals, request, url }) => {
	try {
		const s = requireDirector(locals);
		assertSameOrigin(request, url);
		const body = await readFlowBody(request, ['name', 'sourceId']);
		const store = getServices().director;
		const template =
			typeof body.sourceId === 'string'
				? store.get(s.owuiUserId, body.sourceId)
				: { ...emptyProject(), videoModelId: env.DIRECTOR_VIDEO_MODEL_ID?.trim() ?? '' };
		return flowJson(store.create(s.owuiUserId, body.name, template), locals.requestId, 201);
	} catch (e) {
		return directorError(e, locals.requestId);
	}
};
