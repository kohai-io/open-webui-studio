import { redirect } from '@sveltejs/kit';
import { getServices } from '$lib/server/services';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const callback = new URL('/studio/auth/callback', url.origin).href;
	const started = await getServices().auth.begin(callback, url.searchParams.get('return'));
	cookies.set(
		'studio_oidc_transaction',
		started.transactionHandle,
		cookieOptions(300, url.protocol === 'https:')
	);
	redirect(303, started.authorizationUrl.href);
};

function cookieOptions(maxAge: number, secure: boolean) {
	return { path: '/studio', httpOnly: true, secure, sameSite: 'lax' as const, maxAge };
}
