import { redirect, error, isRedirect } from '@sveltejs/kit';
import { getServices } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const handle = cookies.get('studio_oidc_transaction');
	cookies.delete('studio_oidc_transaction', { path: '/studio' });
	if (!handle) error(401, 'Authentication transaction missing');
	try {
		const completed = await getServices().auth.complete(
			url,
			new URL('/studio/auth/callback', url.origin).href,
			handle
		);
		cookies.set('studio_session', completed.session.handle, {
			path: '/studio',
			httpOnly: true,
			secure: url.protocol === 'https:',
			sameSite: 'lax',
			expires: new Date(completed.session.expiresAt)
		});
		redirect(303, completed.returnPath);
	} catch (cause) {
		if (isRedirect(cause)) throw cause;
		error(401, 'Authentication failed');
	}
};
