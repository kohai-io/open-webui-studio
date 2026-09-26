import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getServices } from '$lib/server/services';
import { requireDirector } from '$lib/server/director/http';
import { loadCatalogue } from '$lib/server/catalogue';
import { DirectorError } from '$lib/director/validation';
export const load: PageServerLoad = async ({ locals, params }) => {
	if (!locals.session) redirect(303, '/studio/auth/login');
	try {
		const s = requireDirector(locals);
		const services = getServices();
		const project = services.director.get(s.owuiUserId, params.id);
		const client = services.owuiForToken(s.owuiToken);
		const [catalogue, images] = await Promise.allSettled([
			loadCatalogue(client),
			client.getImageCapabilities()
		]);
		return {
			project,
			jobs: services.director.jobs(s.owuiUserId, params.id),
			models: catalogue.status === 'fulfilled' ? catalogue.value.models : [],
			videoModels: catalogue.status === 'fulfilled' ? catalogue.value.agents : [],
			catalogueAvailable: catalogue.status === 'fulfilled',
			images: images.status === 'fulfilled' ? images.value : null
		};
	} catch (e) {
		if (e instanceof DirectorError) error(e.status, e.code);
		throw e;
	}
};
