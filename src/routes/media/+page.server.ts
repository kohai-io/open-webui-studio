import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { loadMedia, publicMediaError } from '$lib/server/media-page';
import { getServices } from '$lib/server/services';

export const load: PageServerLoad = async ({ locals, request, url }) => {
	const query = (url.searchParams.get('q') ?? '').trim();
	const cursor = url.searchParams.get('cursor');
	if (query.length > 200) error(400, 'Search query is too long');
	if (!locals.session)
		return {
			authenticated: false as const,
			state: 'authentication_required' as const,
			query,
			items: [],
			nextCursor: null
		};

	try {
		const page = await loadMedia(
			getServices().owuiForToken(locals.session.owuiToken),
			locals.session.owuiUserId,
			query,
			cursor,
			request.signal
		);
		return { authenticated: true as const, state: 'ready' as const, query, ...page };
	} catch (cause) {
		if (cause instanceof TypeError) error(400, 'Invalid media request');
		return {
			authenticated: true as const,
			state: publicMediaError(cause),
			query,
			items: [],
			nextCursor: null
		};
	}
};
