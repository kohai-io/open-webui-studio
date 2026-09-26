import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { getServices } from '$lib/server/services';
export const load: PageServerLoad = ({ locals }) => {
	if (env.DIRECTOR_ENABLED !== 'true') error(404, 'Director is not enabled');
	return {
		authenticated: !!locals.session,
		projects: locals.session ? getServices().director.list(locals.session.owuiUserId) : []
	};
};
