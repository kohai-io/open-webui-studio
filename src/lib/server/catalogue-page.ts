import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { getServices } from './services';
import { loadCatalogue, publicCatalogueError } from './catalogue';

export async function loadCataloguePage(locals: App.Locals) {
	const workspaceModelsUrl = new URL('/workspace/models', getServices().owuiPublicUrl).href;
	if (!locals.session)
		return {
			authenticated: false as const,
			catalogue: null,
			state: 'authentication_required' as const,
			workspaceModelsUrl
		};
	try {
		return {
			authenticated: true as const,
			catalogue: await loadCatalogue(getServices().owuiForToken(locals.session.owuiToken)),
			state: 'ready' as const,
			workspaceModelsUrl
		};
	} catch (error) {
		return {
			authenticated: true as const,
			catalogue: null,
			state: publicCatalogueError(error),
			workspaceModelsUrl
		};
	}
}

export async function launchChat(locals: App.Locals, request: Request) {
	if (!locals.session) return fail(401, { launchError: 'authentication_required' });
	const modelId = String((await request.formData()).get('modelId') ?? '');
	const client = getServices().owuiForToken(locals.session.owuiToken);
	try {
		const available = await client.listModels();
		if (!available.some((model) => model.id === modelId))
			return fail(403, { launchError: 'permission_denied' });
		const target = new URL('/', getServices().owuiPublicUrl);
		target.searchParams.set('models', modelId);
		redirect(303, target.href);
	} catch (error) {
		if (isRedirect(error)) throw error;
		return fail(502, { launchError: publicCatalogueError(error) });
	}
}
