export type ImageCapabilityState =
	'enabled' | 'disabled' | 'permission_denied' | 'unavailable' | 'unknown';
export interface ImageCapabilities {
	generate: ImageCapabilityState;
	edit: ImageCapabilityState;
	canManage: boolean;
}

export function imageCapabilityMessage(
	operation: 'generate' | 'edit',
	state: ImageCapabilityState
): string {
	const label = operation === 'generate' ? 'Image generation' : 'Image editing';
	if (state === 'enabled') return `${label} is enabled in Open WebUI.`;
	if (state === 'disabled') return `${label} is switched off in Open WebUI.`;
	if (state === 'permission_denied')
		return `Your account does not have access to ${operation === 'generate' ? 'image generation' : 'image editing'}.`;
	if (state === 'unknown')
		return `${label} settings cannot be verified for this account. Open WebUI will check access when you run.`;
	return `${label} availability could not be checked. Check the connection and try again.`;
}
