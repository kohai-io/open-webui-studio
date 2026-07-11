import type { OwuiClient } from './owui/client';
import type { OwuiModel, StudioUser } from './owui/contracts';
import { OwuiError } from './owui/errors';
import type { AgentStore, StudioAgent } from './agents/store';

export interface CatalogueData {
	user: StudioUser;
	models: OwuiModel[];
	agents: StudioAgent[];
}

export async function loadCatalogue(
	client: OwuiClient,
	agents?: AgentStore,
	ownerId?: string
): Promise<CatalogueData> {
	const [user, available] = await Promise.all([client.getCurrentUser(), client.listModels()]);
	const modelIds = new Set(available.map((item) => item.id));
	return {
		user,
		models: available,
		agents:
			agents && ownerId ? agents.list(ownerId).filter((item) => modelIds.has(item.modelId)) : []
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
