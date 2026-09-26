import { base } from '$app/paths';
export async function api(path: string, body?: unknown, key?: string, signal?: AbortSignal) {
	const response = await fetch(`${base}/api/director${path}`, {
		method: body === undefined ? 'GET' : 'POST',
		signal,
		headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	const result = await response.json();
	if (!response.ok) throw new Error(result.error ?? 'request_failed');
	return result;
}
export function message(error: unknown): string {
	const code = error instanceof Error ? error.message : 'request_failed';
	const messages: Record<string, string> = {
		frame_crop_ratio_changed:
			'The production ratio changed. Prepare a new video crop before generating.',
		generation_in_progress:
			'This generation is already active or needs checking. Review the existing job in Takes before starting another.',
		status_unavailable:
			'The provider status could not be checked. Studio will check the same task again; it will not submit another generation.',
		revision_conflict:
			'This project changed in another tab. Reload to review those changes before saving.',
		proposal_outdated:
			'The project changed since this proposal was generated. Request a new proposal.',
		last_frame_not_supported:
			'This Runway pipe accepts only a first frame. Remove the last-frame assignment before generating video.',
		video_setup_required:
			'Update the Runway pipe and enable its Studio API valve, then check again.',
		already_submitted:
			'This job has already started. Studio cannot cancel the submitted provider task.',
		reference_image_required: 'Generate or assign an image to every selected reference first.',
		invalid_director_response:
			'The assistant returned an invalid storyboard. The project was not changed.',
		video_duration_4_to_30: 'Seedance shots must be between 4 and 30 seconds.',
		model_required: 'Choose a planning model in the Brief tab.',
		video_model_required: 'Choose the Runway pipe in the Brief tab.',
		queue_full: 'The generation queue is full. Wait for current jobs to finish.',
		authentication_required: 'Sign in again to continue.'
	};
	return messages[code] ?? code.replaceAll('_', ' ');
}
