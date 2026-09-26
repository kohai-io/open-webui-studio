<script lang="ts">
	import type { Job } from '$lib/director/types';
	import { elapsed, jobStatus } from '$lib/director/jobs';
	let { job, now }: { job: Job; now: number } = $props();
</script>

<div class="job-progress">
	<strong>{jobStatus(job, now)}</strong>
	{#if job.lastStatusAt}<small>Last provider update {elapsed(now - job.lastStatusAt)} ago</small
		>{/if}
	{#if job.state === 'queued'}<small>Waiting for the generation worker.</small>
	{:else if job.state === 'submitting'}<small
			>Sending this request once. You can leave this page.</small
		>
	{:else if job.state === 'running'}<small
			>Generation can take several minutes. You can leave this page.</small
		>
	{:else if job.state === 'submission-unknown'}<small
			>Check the existing request in Takes before starting another.</small
		>
	{:else if job.state === 'authentication-required'}<small
			>Sign in and resume this job in Takes.</small
		>{/if}
</div>
