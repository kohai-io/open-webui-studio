export function videoDiagnostics(result: Record<string, unknown>) {
	const providerTaskId =
		typeof result.providerTaskId === 'string' &&
		/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(result.providerTaskId)
			? result.providerTaskId
			: undefined;
	const failureCode =
		result.state === 'failed' &&
		typeof result.failureCode === 'string' &&
		result.failureCode.length <= 128 &&
		/^[A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)*$/.test(result.failureCode)
			? result.failureCode
			: undefined;
	return { providerTaskId, failureCode };
}

export function videoFailureMessage(code?: string): string {
	if (code?.startsWith('SAFETY.') || code?.startsWith('INPUT_PREPROCESSING.SAFETY.'))
		return 'Blocked by provider moderation. The provider did not identify the exact trigger. This generation was not retried.';
	if (code?.startsWith('ASSET.INVALID'))
		return 'The provider could not use an input file. Review its format and dimensions before generating again.';
	if (code === 'THIRD_PARTY.UNAVAILABLE')
		return 'The model provider was unavailable. This generation was not retried.';
	return 'Video generation failed at the provider. Check the task in Runway for more details. This generation was not retried.';
}
