import type { PageServerLoad } from './$types';
import { loadFlowsPage } from '$lib/server/flows/page';

export const load: PageServerLoad = ({ locals, request }) => loadFlowsPage(locals, request.signal);
