import { redirect } from '@sveltejs/kit';
import { getServices } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = ({ cookies }) => {
	const handle = cookies.get('studio_session');
	if (handle) getServices().sessions.revoke(handle);
	cookies.delete('studio_session', { path: '/studio' });
	redirect(303, '/studio');
};
