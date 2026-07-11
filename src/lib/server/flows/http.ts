import { json } from '@sveltejs/kit';
import { FlowExecutionError } from './executions';
import { FlowQueueError } from './queue';
import { FlowStoreError } from './store';

const MAX_API_BODY_BYTES = 1024 * 1024;

export class FlowHttpError extends Error {
	constructor(readonly code: 'validation_failed' | 'permission_denied') {
		super(code);
		this.name = 'FlowHttpError';
	}
}

export function flowJson(value: unknown, requestId: string, status = 200): Response {
	return json(value, {
		status,
		headers: { 'cache-control': 'private, no-store', 'x-request-id': requestId }
	});
}

export function flowErrorResponse(error: unknown, requestId: string): Response {
	let code = 'internal_error';
	let status = 500;
	let issues: unknown;
	if (error instanceof FlowHttpError) {
		code = error.code;
		status = error.code === 'permission_denied' ? 403 : 400;
	} else if (error instanceof FlowQueueError) {
		code = error.code;
		status =
			error.code === 'authentication_required' ? 401 : error.code === 'not_found' ? 404 : 400;
	} else if (error instanceof FlowStoreError) {
		code = error.code;
		status = error.code === 'not_found' ? 404 : error.code === 'validation_failed' ? 400 : 409;
		if (error.issues.length > 0) issues = error.issues;
	} else if (error instanceof FlowExecutionError) {
		code = error.code;
		status = error.code === 'not_found' ? 404 : error.code === 'validation_failed' ? 400 : 409;
	}
	return flowJson({ error: code, ...(issues === undefined ? {} : { issues }) }, requestId, status);
}

export function authenticationRequired(requestId: string): Response {
	return flowJson({ error: 'authentication_required' }, requestId, 401);
}

export function assertSameOrigin(request: Request, url: URL): void {
	const origin = request.headers.get('origin');
	if (origin !== null && origin !== url.origin) throw new FlowHttpError('permission_denied');
}

export async function readFlowBody(
	request: Request,
	allowedFields: readonly string[]
): Promise<Record<string, unknown>> {
	const declared = Number(request.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > MAX_API_BODY_BYTES)
		throw new FlowHttpError('validation_failed');
	const text = await request.text();
	if (Buffer.byteLength(text, 'utf8') > MAX_API_BODY_BYTES)
		throw new FlowHttpError('validation_failed');
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		throw new FlowHttpError('validation_failed');
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new FlowHttpError('validation_failed');
	const record = value as Record<string, unknown>;
	if (Object.keys(record).some((field) => !allowedFields.includes(field)))
		throw new FlowHttpError('validation_failed');
	return record;
}
