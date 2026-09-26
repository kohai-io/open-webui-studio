import type { Job, JobInput, JobState } from './types';

export const blocksGeneration = (state: JobState) =>
	!['succeeded', 'failed', 'cancelled'].includes(state);

export function sameGeneration(a: JobInput, b: JobInput): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === 'storyboard') return true;
	return a.kind === 'reference' ? a.referenceId === b.referenceId : a.shotId === b.shotId;
}

export function elapsed(ms: number): string {
	const seconds = Math.max(0, Math.floor(ms / 1000));
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function jobStateLabel(state: JobState): string {
	const labels: Record<JobState, string> = {
		queued: 'Queued',
		submitting: 'Submitting',
		running: 'Generating',
		succeeded: 'Completed',
		failed: 'Failed',
		cancelled: 'Cancelled',
		'submission-unknown': 'Submission needs checking',
		'authentication-required': 'Sign in to resume'
	};
	return labels[state];
}

export function jobStatus(job: Job, now: number): string {
	return `${jobStateLabel(job.state)} · ${elapsed((blocksGeneration(job.state) ? now : job.updatedAt) - job.createdAt)} elapsed`;
}
