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
		const services = getServices();
		return {
			authenticated: true as const,
			catalogue: await loadCatalogue(
				services.owuiForToken(locals.session.owuiToken),
				services.agents,
				locals.session.owuiUserId
			),
			state: 'ready' as const
		};
	} catch (error) {
		return { authenticated: true as const, catalogue: null, state: publicCatalogueError(error) };
	}
}

export async function createAgent(locals: App.Locals, request: Request) {
	if (!locals.session) return fail(401, { agentError: 'authentication_required' });
	const form = await request.formData();
	const name = String(form.get('name') ?? '').trim();
	const description = String(form.get('description') ?? '').trim();
	const modelId = String(form.get('modelId') ?? '');
	if (!name || name.length > 80 || description.length > 500 || !modelId)
		return fail(400, { agentError: 'invalid_agent' });
	const services = getServices();
	try {
		const available = await services.owuiForToken(locals.session.owuiToken).listModels();
		if (!available.some((model) => model.id === modelId))
			return fail(403, { agentError: 'permission_denied' });
		services.agents.create(locals.session.owuiUserId, { name, description, modelId });
		return { agentCreated: true };
	} catch (error) {
		return fail(502, { agentError: publicCatalogueError(error) });
	}
}

export async function deleteAgent(locals: App.Locals, request: Request) {
	if (!locals.session) return fail(401, { agentError: 'authentication_required' });
	const agentId = String((await request.formData()).get('agentId') ?? '');
	if (!getServices().agents.delete(locals.session.owuiUserId, agentId))
		return fail(404, { agentError: 'not_found' });
	return { agentDeleted: true };
}

export async function launchAgent(locals: App.Locals, request: Request) {
	if (!locals.session) return fail(401, { launchError: 'authentication_required' });
	const services = getServices();
	const agentId = String((await request.formData()).get('agentId') ?? '');
	const agent = services.agents.get(locals.session.owuiUserId, agentId);
	if (!agent) return fail(404, { launchError: 'not_found' });
	const client = services.owuiForToken(locals.session.owuiToken);
	try {
		const available = await client.listModels();
		if (!available.some((model) => model.id === agent.modelId))
			return fail(403, { launchError: 'permission_denied' });
		const chat = await client.createChat(agent.modelId, agent.name);
		redirect(303, new URL(`/c/${encodeURIComponent(chat.id)}`, services.owuiPublicUrl).href);
	} catch (error) {
		if (isRedirect(error)) throw error;
		return fail(502, { launchError: publicCatalogueError(error) });
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
