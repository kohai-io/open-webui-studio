import type { OwuiClient } from './owui/client';
import type { StudioMediaPage } from './owui/contracts';
import { OwuiError } from './owui/errors';

export type MediaPageState =
	'ready' | 'authentication_required' | 'permission_denied' | 'upstream_unavailable';

export async function loadMedia(
	client: OwuiClient,
	ownerId: string,
	query: string,
	cursor: string | null,
	signal?: AbortSignal
): Promise<StudioMediaPage> {
	return query
		? client.searchMedia(ownerId, query, cursor, 24, signal)
		: client.listMedia(ownerId, cursor, 24, signal);
}

export function publicMediaError(
	error: unknown
): Exclude<MediaPageState, 'ready' | 'authentication_required'> {
	if (
		error instanceof OwuiError &&
		(error.code === 'permission_denied' || error.code === 'not_found')
	)
		return 'permission_denied';
	return 'upstream_unavailable';
}
