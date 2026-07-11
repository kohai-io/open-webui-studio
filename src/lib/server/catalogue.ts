import type { OwuiClient } from './owui/client';
import type { OwuiModel, StudioUser } from './owui/contracts';
import { OwuiError } from './owui/errors';

export interface CatalogueData {
	user: StudioUser;
	models: OwuiModel[];
	agents: OwuiModel[];
}

export async function loadCatalogue(client: OwuiClient): Promise<CatalogueData> {
	const [user, available] = await Promise.all([client.getCurrentUser(), client.listModels()]);
	return {
		user,
		models: available.filter((item) => item.kind === 'model'),
		agents: available.filter((item) => item.kind === 'agent')
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
