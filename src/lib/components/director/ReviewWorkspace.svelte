<script lang="ts">
	import { base, resolve } from '$app/paths';
	import { message } from '$lib/director/api';
	import { terminal, type Job, type Project } from '$lib/director/types';
	import { jobStateLabel } from '$lib/director/jobs';
	import { isTakeStale } from '$lib/director/staleness';
	import { videoFailureMessage } from '$lib/director/video';
	import {
		acceptance,
		canCompare,
		matchesReview,
		reviewItems,
		type ReviewItem,
		type ReviewView
	} from '$lib/director/review';
	import JobProgress from './JobProgress.svelte';
	import TakeMedia from './TakeMedia.svelte';
	import './review.css';
	let {
		project,
		jobs,
		now,
		busy,
		dirty,
		selected = $bindable(),
		view = $bindable(),
		noteDrafts = $bindable(),
		onaccept,
		onreview,
		oncancel,
		onresume,
		onstoryboard
	}: {
		project: Project;
		jobs: Job[];
		now: number;
		busy: boolean;
		dirty: boolean;
		selected: string;
		view: ReviewView;
		noteDrafts: Record<string, string>;
		onaccept: (item: ReviewItem) => void;
		onreview: (job: Job, note: string) => void;
		oncancel: (job: Job) => void;
		onresume: (job: Job) => void;
		onstoryboard: (shotId: string) => void;
	} = $props();
	let showDetails = $state(false);
	let compare = $state<string[]>([]);
	const items = $derived(reviewItems(jobs));
	const visible = $derived(items.filter((item) => matchesReview(item, selected, view, project)));
	const active = $derived(visible.find((item) => item.key === view.key) ?? visible[0]);
	const activeIndex = $derived(visible.findIndex((item) => item.key === active?.key));
	const compared = $derived(
		visible.filter((item) => compare.includes(item.key) && canCompare(item))
	);
	const displayed = $derived(compared.length === 2 ? compared : active ? [active] : []);
	const note = $derived(active ? (noteDrafts[active.job.id] ?? active.job.note ?? '') : '');
	const noteDirty = $derived(!!active && note !== (active.job.note ?? ''));
	$effect(() => {
		if (active && view.key !== active.key) view = { ...view, key: active.key };
	});
	function changeFilter() {
		compare = [];
	}
	function choose(key: string) {
		if (compared.length === 2 && !compare.includes(key)) compare = [];
		view = { ...view, key };
	}
	function toggleCompare(item: ReviewItem) {
		compare = compare.includes(item.key)
			? compare.filter((key) => key !== item.key)
			: [...compared.map((other) => other.key).slice(-1), item.key];
	}
	function thumbnail(item: ReviewItem) {
		const id =
			item.job.input.kind === 'video'
				? item.job.snapshot.shots.find((s) => s.id === item.job.input.shotId)?.firstFrame
				: item.fileId;
		return id ? base + '/media/' + encodeURIComponent(id) + '/content' : '';
	}
</script>

<section class="content stack review-workspace" aria-label="Take review">
	<div class="review-toolbar">
		<div class="stack review-title">
			<p class="eyebrow">Review & select</p>
			<h2>Takes</h2>
		</div>
		<div class="row review-filters">
			<label
				>Filter by shot<select bind:value={selected} onchange={changeFilter}>
					<option value="">All shots and references</option>
					{#each project.shots as shot (shot.id)}<option value={shot.id}>{shot.title}</option
						>{/each}
				</select></label
			>
			<label
				>Result type<select
					bind:value={view.kind}
					onchange={() => {
						if (view.kind === 'reference') selected = '';
						changeFilter();
					}}
				>
					<option value="all">All results</option><option value="video">Video takes</option>
					<option value="frames">Frames</option><option value="reference">References</option>
				</select></label
			>
			<label
				>Result status<select bind:value={view.status} onchange={changeFilter}>
					<option value="all">All states</option><option value="accepted">Accepted / in use</option>
					<option value="failed">Failed</option><option value="active">In progress</option>
					<option value="attention">Needs attention</option>
				</select></label
			>
		</div>
	</div>
	{#if active}
		<div class="row">
			<span class="muted">{visible.length} {visible.length === 1 ? 'result' : 'results'}</span>
			{#if compared.length}<span class="pill">{compared.length}/2 selected for comparison</span>
				<button class="quiet" onclick={() => (compare = [])}>Clear comparison</button>
				{#if compared.length === 1}<small>Select another result, then add it to comparison.</small
					>{/if}
			{/if}
			<span class="spacer"></span>
			<button
				class="quiet"
				disabled={activeIndex <= 0}
				onclick={() => choose(visible[activeIndex - 1].key)}>Previous result</button
			>
			<button
				class="quiet"
				disabled={activeIndex >= visible.length - 1}
				onclick={() => choose(visible[activeIndex + 1].key)}>Next result</button
			>
			<button
				aria-expanded={showDetails}
				aria-controls="take-review-details"
				onclick={() => (showDetails = !showDetails)}
			>
				{showDetails ? 'Hide notes & details' : 'Notes & details'}{noteDirty ? ' · Unsaved' : ''}
			</button>
		</div>
		<div class="review-layout" class:with-details={showDetails}>
			<div class="review-main stack">
				<div class="review-screens" class:comparing={displayed.length === 2}>
					{#each displayed as item (item.key)}
						{@const badge = acceptance(item, project)}
						<article
							class="review-take stack"
							aria-label={item.label + ' for ' + item.title}
							class:current={item.key === active.key}
						>
							<div class="row">
								<h3>{item.title} <span class="muted">/</span> {item.label}</h3>
								{#if badge}<span class="pill accepted-badge">{badge}</span>{/if}
								<span class="spacer"></span><span class="pill">{jobStateLabel(item.job.state)}</span
								>
							</div>
							{#key item.key + ':' + (item.fileId ?? '')}<TakeMedia {item} />{/key}
							{#if item.fileId && item.job.state === 'succeeded'}
								<div class="row">
									<button
										class="primary"
										disabled={busy || dirty || project.archived || !!badge}
										onclick={() => onaccept(item)}
										>{badge ||
											(item.job.input.kind === 'video' ? 'Accept take' : 'Use this frame')}</button
									>
									<a class="button" href={resolve(`/media/${item.fileId}/content?download=1`)}
										>Download</a
									>
									<button
										aria-pressed={compare.includes(item.key)}
										onclick={() => toggleCompare(item)}
									>
										{compare.includes(item.key) ? 'Remove from comparison' : 'Add to comparison'}
									</button>
									{#if displayed.length === 2 && item.key !== active.key}
										<button
											class="quiet"
											onclick={() => {
												choose(item.key);
												showDetails = true;
											}}>Notes for {item.label}</button
										>
									{/if}
								</div>
								{#if dirty}<small>Save project changes before accepting a result.</small>{/if}
							{/if}
							{#if isTakeStale(item.job, project)}<p class="notice">
									Shot direction has changed since this take.
								</p>{/if}
							<div class="generation-progress">
								<span class="eyebrow">Generation</span><JobProgress job={item.job} {now} />
							</div>
							{#if item.job.error}<p class="notice error" role="alert">
									{message(new Error(item.job.error))}
								</p>
							{:else if item.job.input.kind === 'video' && item.job.state === 'failed'}
								<p class="notice error" role="alert">{videoFailureMessage(item.job.failureCode)}</p>
							{/if}
							{#if item.job.state === 'queued'}<button
									disabled={busy}
									onclick={() => oncancel(item.job)}>Cancel queued job</button
								>{/if}
							{#if item.job.state === 'authentication-required' || (item.job.state === 'submission-unknown' && item.job.input.kind === 'video')}
								<button disabled={busy} onclick={() => onresume(item.job)}
									>Resume status checks</button
								>
							{/if}
						</article>
					{/each}
				</div>
				<div class="take-strip" role="group" aria-label="Result thumbnails">
					{#each visible as item (item.key)}
						{@const thumb = thumbnail(item)}
						{@const badge = acceptance(item, project)}
						<button
							class="take-thumbnail"
							class:active={item.key === active.key}
							aria-pressed={item.key === active.key}
							aria-label={item.title +
								' · ' +
								item.label +
								' · ' +
								jobStateLabel(item.job.state) +
								(badge ? ' · ' + badge : '')}
							onclick={() => choose(item.key)}
						>
							<div class="thumbnail-media">
								{#if thumb}<img src={thumb} alt="" loading="lazy" />{:else}<span aria-hidden="true"
										>{item.job.input.kind === 'video' ? '▶' : '◇'}</span
									>{/if}
								{#if item.job.input.kind === 'video'}<span class="thumbnail-kind">Video</span>{/if}
							</div>
							<strong>{item.label}</strong><span>{item.title}</span>
							<small>{jobStateLabel(item.job.state)}</small>
							{#if badge}<span class="pill accepted-badge">{badge}</span>{/if}
							{#if compared.some((other) => other.key === item.key)}<span class="pill"
									>Comparing</span
								>{/if}
						</button>
					{/each}
				</div>
			</div>
			{#if showDetails}
				<aside
					id="take-review-details"
					class="review-details panel stack"
					aria-label="Notes and details"
				>
					<div>
						<p class="eyebrow">{active.label}</p>
						<h3>{active.title}</h3>
						<small>{new Date(active.job.createdAt).toLocaleString()}</small>
					</div>
					{#if terminal(active.job.state)}
						<label
							>Review notes<textarea
								value={note}
								oninput={(e) => (noteDrafts[active.job.id] = e.currentTarget.value)}
								placeholder="Identity, performance, dialogue and sound…"></textarea></label
						>
						{#if noteDirty}<small>Unsaved review</small>{/if}
						<button disabled={busy || !noteDirty} onclick={() => onreview(active.job, note)}
							>Save review</button
						>
					{/if}
					{#if active.job.providerTaskId || active.job.failureCode}
						<details>
							<summary>Provider details</summary>
							{#if active.job.providerTaskId}<p>
									Runway task ID: <code>{active.job.providerTaskId}</code>
								</p>{/if}
							{#if active.job.failureCode}<p>
									Failure code: <code>{active.job.failureCode}</code>
								</p>{/if}
						</details>
					{/if}
					<details>
						<summary>Submitted prompt and settings</summary>
						<p class="muted">
							Project v{active.job.input.projectRevision} · {active.job.snapshot.ratio}
						</p>
						{#if active.job.input.kind === 'video'}<p class="muted">
								Requested duration: {active.job.snapshot.shots.find(
									(s) => s.id === active.job.input.shotId
								)?.duration ?? 'Unknown'}s
							</p>{/if}
						<pre>{active.job.prompt}</pre>
						<small>{active.job.instructionVersion}</small>
					</details>
					{#if project.shots.some((s) => s.id === active.job.input.shotId)}
						<button class="quiet" onclick={() => onstoryboard(active.job.input.shotId)}
							>Back to shot</button
						>
					{/if}
				</aside>
			{/if}
		</div>
	{:else}
		<div class="empty">
			<h3>No results match this view.</h3>
			<p class="muted">
				Choose another shot or clear the filters to see the rest of this production.
			</p>
			<button
				onclick={() => {
					selected = '';
					view = { key: '', kind: 'all', status: 'all' };
					compare = [];
				}}>Show all results</button
			>
			<button class="quiet" onclick={() => onstoryboard(selected)}>Back to storyboard</button>
		</div>
	{/if}
</section>
