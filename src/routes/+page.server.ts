import { launchChat, loadCataloguePage } from '$lib/server/catalogue-page';
import type { Actions, PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';

export const load: PageServerLoad = async ({ locals }) => ({
	...(await loadCataloguePage(locals)),
	directorEnabled: env.DIRECTOR_ENABLED === 'true'
});
export const actions: Actions = { launch: ({ locals, request }) => launchChat(locals, request) };
