import { env } from '$env/dynamic/private';
import { DirectorError } from '$lib/director/validation';
import { OwuiError } from '$lib/server/owui/errors';
import { FlowHttpError, flowJson } from '$lib/server/flows/http';
export function requireDirector(locals: App.Locals) {
	if (env.DIRECTOR_ENABLED !== 'true') throw new DirectorError('not_found', 404);
	if (!locals.session) throw new DirectorError('authentication_required', 401);
	return locals.session;
}
export function directorError(error: unknown, requestId: string) {
	if (error instanceof DirectorError || error instanceof OwuiError)
		return flowJson({ error: error.code }, requestId, error.status);
	if (error instanceof FlowHttpError)
		return flowJson(
			{ error: error.code },
			requestId,
			error.code === 'permission_denied' ? 403 : 400
		);
	if (error instanceof TypeError) return flowJson({ error: 'validation_failed' }, requestId, 400);
	return flowJson({ error: 'internal_error' }, requestId, 500);
}
