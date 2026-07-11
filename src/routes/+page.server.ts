import { launchChat, loadCataloguePage } from '$lib/server/catalogue-page';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => loadCataloguePage(locals);
export const actions: Actions = { launch: ({ locals, request }) => launchChat(locals, request) };
