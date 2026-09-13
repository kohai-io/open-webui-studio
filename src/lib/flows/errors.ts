export function flowExecutionErrorMessage(code: string): string {
	if (code === 'image_prompt_required')
		return 'Enter an image prompt under Run this flow, or set an Input default value.';
	if (code === 'image_access_denied')
		return 'Open WebUI denied image generation or editing. Check Admin Settings > Images and your account permissions.';
	return `Run ended with ${code.replaceAll('_', ' ')}.`;
}
