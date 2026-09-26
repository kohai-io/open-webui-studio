<script lang="ts">
	import { base } from '$app/paths';
	import type { ReviewItem } from '$lib/director/review';
	import { jobStateLabel } from '$lib/director/jobs';
	let { item }: { item: ReviewItem } = $props();
	let duration = $state<number | null>(null);
	let failed = $state(false);
	const media = (id: string) => base + '/media/' + encodeURIComponent(id) + '/content';
</script>

<div class="review-media" class:missing={!item.fileId}>
	{#if item.fileId}
		{#if item.job.input.kind === 'video'}
			<video
				src={media(item.fileId)}
				aria-label={item.label + ' preview'}
				controls
				preload="metadata"
				playsinline
				onloadedmetadata={(e) => {
					const value = e.currentTarget.duration;
					duration = Number.isFinite(value) && value > 0 ? value : null;
					failed = false;
				}}
				onerror={() => (failed = true)}><track kind="captions" /></video
			>
		{:else}
			<img
				src={media(item.fileId)}
				alt={item.label + ' for ' + item.title}
				onerror={() => (failed = true)}
			/>
		{/if}
	{:else}
		<div class="placeholder">
			<span class="mark" aria-hidden="true">{item.job.state === 'failed' ? '!' : '◷'}</span>
			<h3>{jobStateLabel(item.job.state)}</h3>
			<p>
				{item.job.state === 'failed' || item.job.state === 'cancelled'
					? 'No media was returned for this attempt.'
					: 'Your result will appear here when it is available.'}
			</p>
		</div>
	{/if}
</div>
{#if duration !== null}<small class="clip-duration">Clip duration: {duration.toFixed(2)}s</small
	>{/if}
{#if failed}<p class="notice" role="alert">
		This preview could not be loaded. Try Download to inspect the file.
	</p>{/if}
