import type { RequestHandler } from './$types';
import { getServices } from '$lib/server/services';
import { authenticationRequired, flowJson } from '$lib/server/flows/http';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.session) return authenticationRequired(locals.requestId);
	return flowJson(
		await getServices().owuiForToken(locals.session.owuiToken).getImageCapabilities(),
		locals.requestId
	);
};
