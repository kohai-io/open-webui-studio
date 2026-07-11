import { fail, isRedirect, redirect } from '@sveltejs/kit';
import { getServices } from './services';
import { loadCatalogue, publicCatalogueError } from './catalogue';

export async function loadCataloguePage(locals: App.Locals) {
	if (!locals.session)
		return {
			authenticated: false as const,
			catalogue: null,
			state: 'authentication_required' as const
		};
	try {
		return {
			authenticated: true as const,
			catalogue: await loadCatalogue(getServices().owuiForToken(locals.session.owuiToken)),
			state: 'ready' as const
		};
	} catch (error) {
		return { authenticated: true as const, catalogue: null, state: publicCatalogueError(error) };
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
		const chat = await client.createChat(modelId);
		const target = new URL(`/c/${encodeURIComponent(chat.id)}`, getServices().owuiPublicUrl);
		redirect(303, target.href);
	} catch (error) {
		if (isRedirect(error)) throw error;
		return fail(502, { launchError: publicCatalogueError(error) });
	}
}
