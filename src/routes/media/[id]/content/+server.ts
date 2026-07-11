import type { RequestHandler } from './$types';
import { getServices } from '$lib/server/services';
import { OwuiError } from '$lib/server/owui/errors';

export const GET: RequestHandler = async ({ locals, params, request, url }) => {
	if (!locals.session) return new Response(null, { status: 401 });
	try {
		const response = await getServices()
			.owuiForToken(locals.session.owuiToken)
			.openMediaContent(
				params.id,
				locals.session.owuiUserId,
				url.searchParams.get('download') === '1' ? 'download' : 'preview',
				request.headers.get('range') ?? undefined
			);
		response.headers.set('cache-control', 'private, no-store');
		return response;
	} catch (cause) {
		if (cause instanceof OwuiError) return new Response(null, { status: cause.status });
		if (cause instanceof TypeError) return new Response(null, { status: 400 });
		return new Response(null, { status: 502 });
	}
};
