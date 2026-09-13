export type OwuiErrorCode =
	| 'image_prompt_required'
	| 'image_access_denied'
	| 'authentication_required'
	| 'permission_denied'
	| 'not_found'
	| 'conflict'
	| 'rate_limited'
	| 'timeout'
	| 'invalid_response'
	| 'upstream_unavailable';
export class OwuiError extends Error {
	constructor(
		public readonly code: OwuiErrorCode,
		public readonly status: number,
		public readonly requestId: string,
		options?: ErrorOptions
	) {
		super(code, options);
		this.name = 'OwuiError';
	}
}
export function mapOwuiStatus(status: number): OwuiErrorCode {
	if (status === 401) return 'authentication_required';
	if (status === 403) return 'permission_denied';
	if (status === 404) return 'not_found';
	if (status === 409) return 'conflict';
	if (status === 429) return 'rate_limited';
	if (status === 408 || status === 504) return 'timeout';
	return 'upstream_unavailable';
}
