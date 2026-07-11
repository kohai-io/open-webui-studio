import type { OwuiClient } from './owui/client';
import type { OwuiModel, StudioUser } from './owui/contracts';
import { OwuiError } from './owui/errors';

export interface CatalogueData {
	user: StudioUser;
	models: OwuiModel[];
	agents: OwuiModel[];
}

export async function loadCatalogue(client: OwuiClient): Promise<CatalogueData> {
	const [user, available, workspaceModels, functions] = await Promise.all([
		client.getCurrentUser(),
		client.listModels(),
		client.listWorkspaceModels(),
		client.listFunctions()
	]);
	const workspaceById = new Map(workspaceModels.map((item) => [item.id, item]));
	const agentIds = new Set([
		...workspaceModels.filter((item) => item.isActive && item.baseModelId).map((item) => item.id),
		...functions.filter((item) => item.isActive).map((item) => item.id)
	]);
	const merged = available.map((item) => {
		const workspace = workspaceById.get(item.id);
		return workspace
			? {
					...item,
					name: workspace.name,
					tags: workspace.tags,
					kind: agentIds.has(item.id) ? ('agent' as const) : item.kind
				}
			: { ...item, kind: agentIds.has(item.id) ? ('agent' as const) : item.kind };
	});
	return {
		user,
		models: merged.filter((item) => item.kind === 'model'),
		agents: merged.filter((item) => item.kind === 'agent')
	};
}

export function publicCatalogueError(error: unknown): 'permission_denied' | 'upstream_unavailable' {
	if (
		error instanceof OwuiError &&
		(error.code === 'permission_denied' || error.code === 'not_found')
	) {
		return 'permission_denied';
	}
	return 'upstream_unavailable';
}
