import { getServices } from '$lib/server/services';
import type { FlowExecutionStore } from './executions';
import type { FlowStore } from './store';
import type { OwuiClient } from '$lib/server/owui/client';
import { loadCatalogue, publicCatalogueError } from '$lib/server/catalogue';

interface FlowPageServices {
	flows: FlowStore;
	flowExecutions: FlowExecutionStore;
	owuiForToken: (token: string) => OwuiClient;
}

export async function loadFlowsPage(
	locals: App.Locals,
	requestSignal?: AbortSignal,
	services?: FlowPageServices
) {
	if (!locals.session)
		return {
			authenticated: false as const,
			state: 'authentication_required' as const,
			flows: [],
			executions: [],
			selectedFlow: null,
			models: []
		};
	const resolvedServices = services ?? getServices();
	const owner = locals.session.owuiUserId;
	const flows = resolvedServices.flows.list(owner);
	const executions = resolvedServices.flowExecutions.list(owner);
	const selectedFlow = flows[0] ? resolvedServices.flows.get(owner, flows[0].id) : null;
	try {
		const catalogue = await loadCatalogue(resolvedServices.owuiForToken(locals.session.owuiToken));
		if (requestSignal?.aborted) throw requestSignal.reason;
		return {
			authenticated: true as const,
			state: 'ready' as const,
			flows,
			executions,
			selectedFlow,
			models: catalogue.models
		};
	} catch (error) {
		return {
			authenticated: true as const,
			state: publicCatalogueError(error),
			flows,
			executions,
			selectedFlow,
			models: []
		};
	}
}
