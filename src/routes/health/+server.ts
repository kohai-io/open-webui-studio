import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ locals }) =>
	json(
		{
			status: 'ok',
			service: 'open-webui-studio',
			version: '0.0.1'
		},
		{ headers: { 'x-request-id': locals.requestId } }
	);
