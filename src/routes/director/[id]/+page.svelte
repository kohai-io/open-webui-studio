<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { base, resolve } from '$app/paths';
	import { beforeNavigate } from '$app/navigation';
	import { api, message } from '$lib/director/api';
	import {
		emptyShot,
		compilePrompt,
		terminal,
		type Job,
		type JobKind,
		type Project
	} from '$lib/director/types';
	import { isTakeStale } from '$lib/director/staleness';
	import { videoFailureMessage } from '$lib/director/video';
	import FramePicker from '$lib/components/director/FramePicker.svelte';
	import '$lib/components/director/director.css';
	let { data } = $props();
	let project = $state<Project>(untrack(() => structuredClone(data.project)));
	let saved = $state(untrack(() => JSON.stringify(data.project)));
	let jobs = $state<Job[]>(untrack(() => data.jobs));
	let selected = $state(untrack(() => data.project.shots[0]?.id ?? ''));
	let tab = $state('Storyboard');
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let instruction = $state('');
	let capabilities = $state<Record<string, unknown> | null>(null);
	let compare = $state<string[]>([]);
	let batch = $state<string[]>([]);
	let reviewNotes = $state<Record<string, string>>({});
	let playing = $state('');
	let refreshing = false;
	const dirty = $derived(JSON.stringify(project) !== saved);
	const shot = $derived(project.shots.find((s) => s.id === selected));
	const shotJobs = $derived(jobs.filter((j) => j.input.shotId === selected));
	const accepted = $derived(
		project.shots.map((s) => ({
			shot: s,
			job: jobs.find((j) => j.id === s.acceptedTakeId && j.state === 'succeeded')
		}))
	);
	const media = (id: string) => `${base}/media/${encodeURIComponent(id)}/content`;
	const path = () => `/${project.id}`;
	beforeNavigate(({ cancel }) => {
		if (dirty && !window.confirm('Leave with unsaved project changes?')) cancel();
	});
	onMount(() => {
		const timer = setInterval(() => {
			if (!document.hidden) void refresh();
		}, 2500);
		const unload = (event: BeforeUnloadEvent) => {
			if (dirty) event.preventDefault();
		};
		window.addEventListener('beforeunload', unload);
		return () => {
			clearInterval(timer);
			window.removeEventListener('beforeunload', unload);
		};
	});
	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			const result = await api(path());
			jobs = result.jobs;
		} catch {
			/* next poll reconnects; explicit actions surface errors */
		} finally {
			refreshing = false;
		}
	}
	async function save() {
		const result = await api(path(), {
			operation: 'save',
			revision: project.revision,
			document: project,
			archived: project.archived
		});
		project = result;
		saved = JSON.stringify(result);
		notice = 'Project saved.';
	}
	async function run(action: () => Promise<void>) {
		busy = true;
		error = '';
		notice = '';
		try {
			await action();
		} catch (e) {
			error = message(e);
		} finally {
			busy = false;
		}
	}
	function addShot() {
		const s = emptyShot(crypto.randomUUID());
		s.title = `Shot ${project.shots.length + 1}`;
		project.shots.push(s);
		selected = s.id;
		tab = 'Storyboard';
	}
	function move(delta: number) {
		const i = project.shots.findIndex((s) => s.id === selected);
		if (i + delta < 0 || i + delta >= project.shots.length) return;
		[project.shots[i], project.shots[i + delta]] = [project.shots[i + delta], project.shots[i]];
	}
	function duplicateShot() {
		if (!shot) return;
		const copy = {
			...structuredClone($state.snapshot(shot)),
			id: crypto.randomUUID(),
			title: `${shot.title} copy`,
			acceptedTakeId: ''
		};
		project.shots.splice(project.shots.indexOf(shot) + 1, 0, copy);
		selected = copy.id;
	}
	async function queue(kind: JobKind, referenceId = '', extra = '', target = selected) {
		if (dirty) await save();
		await api(
			path(),
			{
				operation: 'queue',
				revision: project.revision,
				input: { kind, shotId: target, referenceId, instruction: extra || instruction }
			},
			crypto.randomUUID()
		);
		notice = 'Generation queued. You can leave this page while it runs.';
		await refresh();
	}
	async function apply(job: Job, fileId?: string) {
		if (dirty) throw new Error('Save your edits before accepting a result.');
		project = await api(path(), {
			operation: 'apply',
			revision: project.revision,
			jobId: job.id,
			fileId
		});
		saved = JSON.stringify(project);
		if (!selected) selected = project.shots[0]?.id ?? '';
		notice = 'Result accepted.';
	}
	async function queueBatch() {
		if (dirty) await save();
		for (const id of batch) await queue('video', '', '', id);
		notice = `${batch.length} shots queued. Existing accepted takes are preserved.`;
		batch = [];
	}
	async function undo() {
		if (dirty) throw new Error('Save your edits before undoing.');
		project = await api(path(), { operation: 'undo', revision: project.revision });
		saved = JSON.stringify(project);
		selected = project.shots[0]?.id ?? '';
	}
	function toggleReference(id: string, checked: boolean) {
		if (shot)
			shot.referenceIds = checked
				? [...shot.referenceIds, id]
				: shot.referenceIds.filter((item) => item !== id);
	}
	function nextVideo() {
		const index = accepted.findIndex((a) => a.shot.id === playing);
		playing = accepted.slice(index + 1).find((a) => a.job)?.shot.id ?? '';
	}
</script>

<svelte:head><title>{project.name} · Director</title></svelte:head>
<div class="director">
	<nav class="topbar">
		<a class="brand" href={resolve('/director')}>Studio <span>/ Director</span></a><span
			class="muted">/</span
		><strong>{project.name}</strong><span class="spacer"></span><span class="pill"
			>{dirty ? 'Unsaved changes' : `Saved · v${project.revision}`}</span
		><button disabled={busy || project.revision < 2} onclick={() => run(undo)}
			>Undo last save</button
		><button class="primary" disabled={busy || !dirty} onclick={() => run(save)}
			>Save project</button
		>
	</nav>
	{#if error}<div role="alert" class="notice error">{error}</div>{/if}
	{#if notice}<div role="status" class="notice">{notice}</div>{/if}
	{#if project.archived}<div class="notice">
			This project is archived. Restore it in Brief to generate new material.
		</div>{/if}
	{#if !data.catalogueAvailable}<div class="notice">
			Models are currently unavailable. You can keep editing the project.
		</div>{/if}
	<div class="tabs" role="tablist" aria-label="Production workspace">
		{#each ['Brief', 'References', 'Storyboard', 'Assistant', 'Takes', 'Sequence'] as name (name)}<button
				role="tab"
				aria-selected={tab === name}
				class:active={tab === name}
				onclick={() => (tab = name)}
				>{name}{name === 'Storyboard' ? ` (${project.shots.length})` : ''}</button
			>{/each}
	</div>
	<main>
		<fieldset class="editing-surface" disabled={busy}>
			{#if tab === 'Brief'}
				<div class="content columns">
					<section class="panel stack">
						<p class="eyebrow">The production</p>
						<h2>What are we making?</h2>
						<label>Project name<input bind:value={project.name} maxlength="200" /></label>
						<div class="columns">
							<label
								>Production format<input
									bind:value={project.format}
									placeholder="TV episode, film, trailer, promo…"
								/></label
							><label>Dialogue language<input bind:value={project.language} /></label>
						</div>
						<label
							>Brief<textarea
								rows="7"
								bind:value={project.brief}
								placeholder="The story, audience and what the viewer should feel."
							></textarea></label
						><label
							>Visual treatment<textarea
								bind:value={project.style}
								placeholder="Palette, lighting, texture and composition."></textarea></label
						><label
							>Video aspect ratio<select bind:value={project.ratio}
								><option>16:9</option><option>9:16</option><option>1:1</option></select
							></label
						><label class="check"
							><input type="checkbox" bind:checked={project.archived} /> Archived</label
						>
					</section>
					<section class="panel stack">
						<p class="eyebrow">Your creative team</p>
						<h2>Models and generation</h2>
						<label
							>Planning model<select bind:value={project.modelId}
								><option value="">Choose Astra, Opus or another text model</option
								>{#each data.models as model (model.id)}<option value={model.id}
										>{model.name}</option
									>{/each}</select
							></label
						><small>Planning uses the production instructions included with Director.</small><label
							>Video pipe<select
								bind:value={project.videoModelId}
								onchange={() => (capabilities = null)}
								><option value="">Choose your Runway pipe</option
								>{#if project.videoModelId && !data.videoModels.some((model) => model.id === project.videoModelId)}<option
										value={project.videoModelId}
										disabled>{project.videoModelId} (unavailable in catalogue)</option
									>{/if}{#each data.videoModels as model (model.id)}<option value={model.id}
										>{model.name}</option
									>{/each}</select
							></label
						><button
							disabled={busy || !project.videoModelId}
							onclick={() =>
								run(async () => {
									if (dirty) await save();
									capabilities = await api(path(), { operation: 'capabilities' });
								})}>Check video connection</button
						>{#if capabilities}<p class="notice">
								{capabilities.enabled
									? 'Seedance ready · first frame · 4–30 seconds · generated audio'
									: 'Enable ENABLE_STUDIO_API in the updated Runway pipe’s valves.'}
							</p>{/if}
						<hr class="divider" />
						<h3>Image generation</h3>
						<p class="muted">
							Uses the image provider configured in Open WebUI. Set it to GPT Image 2.5 for this
							workflow.
						</p>
						<p>
							Generation: {data.images?.generate ?? 'unavailable'} · Editing: {data.images?.edit ??
								'unavailable'}
						</p>
						<small
							>Reference images are used in image editing to establish identity. This video pipe
							takes one first frame; additional references and last-frame control are not supported.
							Video may crop frames to the selected aspect ratio.</small
						>
					</section>
				</div>
			{:else if tab === 'References'}
				<div class="content stack">
					<div class="row">
						<div class="stack">
							<p class="eyebrow">Cast, places and visual language</p>
							<h2>Reference library</h2>
						</div>
						<span class="spacer"></span><button
							disabled={busy}
							onclick={() =>
								project.references.push({
									id: crypto.randomUUID(),
									name: 'New character',
									role: 'identity',
									description: '',
									fileId: ''
								})}>+ Add reference</button
						>
					</div>
					<div class="reference-grid">
						{#each project.references as ref (ref.id)}<section class="panel stack">
								<label>Reference name<input bind:value={ref.name} /></label><label
									>Role<select bind:value={ref.role}
										><option value="identity">Character identity</option><option value="wardrobe"
											>Wardrobe</option
										><option value="location">Location</option><option value="prop">Prop</option
										><option value="style">Visual style</option></select
									></label
								><label
									>Description<textarea
										bind:value={ref.description}
										placeholder="Appearance, wardrobe and details to preserve."></textarea></label
								><FramePicker
									fileId={ref.fileId}
									onchange={(id) => (ref.fileId = id)}
									disabled={busy}
								/><button
									disabled={busy || !ref.description || project.archived}
									onclick={() => run(() => queue('reference', ref.id, '', ''))}
									>{ref.fileId ? 'Create reference variation' : 'Generate reference'}</button
								><button
									class="quiet danger"
									disabled={busy}
									onclick={() => {
										project.references = project.references.filter((r) => r.id !== ref.id);
										project.shots.forEach(
											(s) => (s.referenceIds = s.referenceIds.filter((id) => id !== ref.id))
										);
									}}>Remove from project</button
								>
							</section>{:else}<div class="empty">
								<h2>Give the story a consistent world.</h2>
								<p class="muted">
									Add character, wardrobe or location references. Assign them to individual shots,
									then use them to create your frames.
								</p>
							</div>{/each}
					</div>
				</div>
			{:else if tab === 'Storyboard'}
				<div class="workspace">
					<aside class="shot-list">
						<p class="eyebrow">Shot list</p>
						<details>
							<summary>Batch generation</summary>
							<div class="stack">
								{#each project.shots as item (item.id)}<label class="check"
										><input
											type="checkbox"
											checked={batch.includes(item.id)}
											onchange={(e) =>
												(batch = e.currentTarget.checked
													? [...batch, item.id]
													: batch.filter((id) => id !== item.id))}
										/>{item.title}</label
									>{/each}<button
									disabled={busy || !batch.length || !project.videoModelId || project.archived}
									onclick={() => run(queueBatch)}>Generate {batch.length} selected shots</button
								><small>Each selected shot uses provider credits.</small>
							</div>
						</details>
						{#each project.shots as item, i (item.id)}<button
								class="shot-item"
								class:active={selected === item.id}
								onclick={() => (selected = item.id)}
								><span class="shot-number">{String(i + 1).padStart(2, '0')}</span><span
									>{item.title}<small
										>{item.duration}s · {item.acceptedTakeId
											? 'Take accepted'
											: item.firstFrame
												? 'Frame ready'
												: 'Draft'}</small
									></span
								></button
							>{/each}<button onclick={addShot}>+ Add shot</button><button
							class="quiet"
							onclick={() => (tab = 'Assistant')}>Draft with Assistant</button
						>
					</aside>
					{#if shot}<section class="viewer stack">
							<div class="row">
								<p class="eyebrow">Shot {project.shots.indexOf(shot) + 1}</p>
								<span class="spacer"></span><button
									class="quiet"
									onclick={() => move(-1)}
									disabled={project.shots.indexOf(shot) === 0}>Move earlier</button
								><button
									class="quiet"
									onclick={() => move(1)}
									disabled={project.shots.indexOf(shot) === project.shots.length - 1}
									>Move later</button
								>
							</div>
							<h2>{shot.title}</h2>
							<div class="frame">
								{#if shot.firstFrame}<img
										src={media(shot.firstFrame)}
										alt={`First frame for ${shot.title}`}
									/>{:else}<div class="placeholder">
										<span class="mark">⌗</span>
										<h3>Find the frame.</h3>
										<p>
											Describe the action and assign your references,<br />then generate a first
											frame.
										</p>
									</div>{/if}
							</div>
							<div class="row">
								<button
									disabled={busy || !shot.action || project.archived}
									onclick={() => run(() => queue('first-frame'))}>Generate first frame</button
								><button
									disabled={busy || !shot.action || project.archived}
									onclick={() =>
										run(() =>
											queue(
												'first-frame',
												'',
												'Create a close-up of the selected subject. Preserve identity and wardrobe.'
											)
										)}>Create close-up</button
								><button
									class="primary"
									disabled={busy ||
										!shot.action ||
										!project.videoModelId ||
										!!shot.lastFrame ||
										project.archived}
									onclick={() => run(() => queue('video'))}>Generate video + audio</button
								>
							</div>
							<small
								>Generate uses provider credits. Only this shot is submitted. Review results in
								Takes.</small
							>
							<details>
								<summary>Assign or replace first frame</summary><FramePicker
									fileId={shot.firstFrame}
									onchange={(id) => {
										if (shot) shot.firstFrame = id;
									}}
									disabled={busy}
								/>
							</details>
							<details>
								<summary>Last frame and prompt overrides</summary>
								<div class="stack">
									<p class="muted">
										You can prepare an ending image here. Remove its assignment before generating
										with the current first-frame-only video pipe.
									</p>
									<FramePicker
										fileId={shot.lastFrame}
										onchange={(id) => {
											if (shot) shot.lastFrame = id;
										}}
										disabled={busy}
									/><button
										disabled={busy || !shot.action}
										onclick={() => run(() => queue('last-frame'))}>Generate last frame</button
									><label
										>Additional frame direction<textarea bind:value={shot.framePrompt}
										></textarea></label
									><label
										>Additional video direction<textarea bind:value={shot.videoPrompt}
										></textarea></label
									>
									<pre>{compilePrompt(project, shot, 'video')}</pre>
								</div>
							</details>
							<div class="row">
								<span class="pill">{shotJobs.length} generation records</span><button
									class="quiet"
									onclick={() => (tab = 'Takes')}>Review takes →</button
								><button class="quiet" onclick={duplicateShot}>Duplicate shot</button><button
									class="quiet danger"
									onclick={() => {
										project.shots = project.shots.filter((s) => s.id !== selected);
										selected = project.shots[0]?.id ?? '';
									}}>Remove shot</button
								>
							</div>
						</section>
						<aside class="inspector">
							<form onsubmit={(e) => e.preventDefault()}>
								<p class="eyebrow">Shot direction</p>
								<label>Shot title<input bind:value={shot.title} /></label><label
									>Subject and action<textarea bind:value={shot.action}></textarea></label
								><label>Camera and framing<textarea bind:value={shot.camera}></textarea></label
								><label>Setting and lighting<textarea bind:value={shot.setting}></textarea></label
								><label
									>Duration in seconds<input
										type="number"
										min="1"
										max="120"
										bind:value={shot.duration}
									/></label
								><label
									>Dialogue, speaker and delivery<textarea
										bind:value={shot.dialogue}
										placeholder="Maya, quietly: “We made it.”"></textarea></label
								><label
									>Sound and music<textarea
										bind:value={shot.sound}
										placeholder="Room tone, footsteps, no music."></textarea></label
								><label>Continuity notes<textarea bind:value={shot.continuity}></textarea></label>
								<div class="stack">
									<h3>Assigned references</h3>
									{#each project.references as ref (ref.id)}<label class="check"
											><input
												type="checkbox"
												checked={shot.referenceIds.includes(ref.id)}
												onchange={(e) => toggleReference(ref.id, e.currentTarget.checked)}
											/>{ref.name}</label
										>{:else}<p class="muted">Add references in the References tab.</p>{/each}
								</div>
							</form>
						</aside>
					{:else}<section class="empty">
							<p class="eyebrow">An open storyboard</p>
							<h1>Start with a moment.</h1>
							<p class="muted">
								Add your first shot, or give the Assistant a brief and review its proposed sequence.
							</p>
							<div class="row">
								<button class="primary" onclick={addShot}>+ Add first shot</button><button
									onclick={() => (tab = 'Assistant')}>Open Assistant</button
								>
							</div>
						</section>{/if}
				</div>
			{:else if tab === 'Assistant'}
				<div class="content columns">
					<section class="panel stack">
						<p class="eyebrow">Creative support</p>
						<h2>Shape the sequence.</h2>
						<p class="muted">
							Draft from the project brief or revise a selected shot. Proposed changes stay separate
							until you apply them.
						</p>
						<label
							>Direction for the Assistant<textarea
								rows="6"
								bind:value={instruction}
								placeholder="Build tension over three shots, ending on a close-up."
							></textarea></label
						><label
							>Selected shot<select bind:value={selected}
								><option value="">No shot selected</option>{#each project.shots as s (s.id)}<option
										value={s.id}>{s.title}</option
									>{/each}</select
							></label
						>
						<div class="row">
							<button
								class="primary"
								disabled={busy || !project.modelId || !project.brief || project.archived}
								onclick={() => run(() => queue('storyboard', '', '', ''))}>Draft storyboard</button
							><button
								disabled={busy || !selected || !project.modelId || project.archived}
								onclick={() => run(() => queue('revise'))}>Revise selected shot</button
							>
						</div>
						<small
							>Choose the planning model and enter your brief in Brief. Applying a storyboard adds
							shots; revising changes only the selected shot.</small
						>
					</section>
					<section class="stack">
						{#each jobs.filter( (j) => ['storyboard', 'revise'].includes(j.input.kind) ) as job (job.id)}<article
								class="panel stack"
							>
								<div class="row">
									<h3>
										{job.input.kind === 'storyboard' ? 'Storyboard proposal' : 'Shot revision'}
									</h3>
									<span class="pill">{job.state}</span>
								</div>
								{#if job.proposal}{#each job.proposal as proposed (proposed.id)}<div>
											<strong>{proposed.title} · {proposed.duration}s</strong>
											<p class="muted">{proposed.action}</p>
										</div>{/each}<button
										disabled={busy || dirty || job.input.projectRevision !== project.revision}
										onclick={() => run(() => apply(job))}>Apply proposal</button
									>{#if job.input.projectRevision !== project.revision}<small
											>Project changed since this proposal. Generate a new proposal to apply
											changes.</small
										>{/if}{/if}{#if job.error}<p role="alert">
										{message(new Error(job.error))}
									</p>{/if}
							</article>{:else}<div class="empty">
								<h3>Ideas, with room for your judgement.</h3>
								<p class="muted">Your first proposal will appear here.</p>
							</div>{/each}
					</section>
				</div>
			{:else if tab === 'Takes'}
				<div class="content stack">
					<div class="row">
						<h2>Generation history</h2>
						<span class="spacer"></span><label
							>Filter by shot<select bind:value={selected}
								><option value="">All shots and references</option
								>{#each project.shots as s (s.id)}<option value={s.id}>{s.title}</option
									>{/each}</select
							></label
						><button disabled={busy || compare.length !== 2} onclick={() => (compare = [])}
							>Clear comparison</button
						>
					</div>
					<p class="muted">
						Select two results to compare. Accepted takes remain available when you revise a shot.
					</p>
					<div class="takes-grid">
						{#each jobs.filter((j) => !j.proposal && (compare.length === 2 ? compare.includes(j.id) : !selected || j.input.shotId === selected || j.input.kind === 'reference')) as job (job.id)}<article
								class="panel take"
							>
								<div class="row">
									<strong
										>{job.snapshot.shots.find((s) => s.id === job.input.shotId)?.title ??
											job.snapshot.references.find((r) => r.id === job.input.referenceId)?.name ??
											'Generation'}</strong
									><span class="pill">{job.input.kind}</span>
								</div>
								<small>{new Date(job.createdAt).toLocaleString()} · {job.state}</small
								>{#if isTakeStale(job, project)}<small class="notice"
										>Shot direction has changed since this take.</small
									>{/if}{#each job.fileIds ?? [] as id (id)}{#if job.input.kind === 'video'}<video
											src={media(id)}
											controls
											preload="metadata"><track kind="captions" /></video
										>{:else}<img src={media(id)} alt={`${job.input.kind} result`} />{/if}
									<div class="row">
										<button disabled={busy || dirty} onclick={() => run(() => apply(job, id))}
											>{project.shots.some((s) => s.acceptedTakeId === job.id)
												? 'Accepted take'
												: 'Use this result'}</button
										><a class="button" href={resolve(`/media/${id}/content?download=1`)}>Download</a
										>
									</div>{/each}{#if job.fileIds?.length}<label class="check"
										><input
											type="checkbox"
											checked={compare.includes(job.id)}
											onchange={(e) =>
												(compare = e.currentTarget.checked
													? [...compare.slice(-1), job.id]
													: compare.filter((id) => id !== job.id))}
										/>Compare result</label
									>{/if}{#if job.error}<p role="alert">
										{message(new Error(job.error))}
									</p>{/if}
								{#if job.input.kind === 'video' && job.state === 'failed' && !job.error}
									<p role="alert">{videoFailureMessage(job.failureCode)}</p>
								{/if}
								{#if job.providerTaskId || job.failureCode}
									<details>
										<summary>Provider details</summary>
										{#if job.providerTaskId}<p>
												Runway task ID: <code>{job.providerTaskId}</code>
											</p>{/if}
										{#if job.failureCode}<p>Failure code: <code>{job.failureCode}</code></p>{/if}
									</details>
								{/if}
								{#if job.state === 'submission-unknown'}<p class="muted">
										The provider may have accepted this request. Check the existing task before
										generating again.
									</p>{/if}{#if job.state === 'queued'}<button
										disabled={busy}
										onclick={() =>
											run(async () => {
												await api(path(), { operation: 'cancel', jobId: job.id });
												await refresh();
											})}>Cancel queued job</button
									>{/if}{#if job.state === 'authentication-required' || (job.state === 'submission-unknown' && job.input.kind === 'video')}<button
										disabled={busy}
										onclick={() =>
											run(async () => {
												await api(path(), { operation: 'resume', jobId: job.id });
												await refresh();
											})}>Resume status checks</button
									>{/if}
								{#if terminal(job.state)}<label
										>Review notes<textarea
											value={reviewNotes[job.id] ?? job.note ?? ''}
											oninput={(e) => (reviewNotes[job.id] = e.currentTarget.value)}
											placeholder="Identity, performance, dialogue and sound…"></textarea></label
									><button
										disabled={busy}
										onclick={() =>
											run(async () => {
												await api(path(), {
													operation: 'review',
													jobId: job.id,
													note: reviewNotes[job.id] ?? job.note ?? ''
												});
												await refresh();
												notice = 'Review saved.';
											})}>Save review</button
									>{/if}
								<details>
									<summary>Submitted prompt and settings</summary>
									<p class="muted">
										Project v{job.input.projectRevision} · {job.instructionVersion} · {job.snapshot
											.ratio}
									</p>
									<pre>{job.prompt}</pre>
								</details>
							</article>{:else}<div class="empty">
								<h3>No takes in this view yet.</h3>
								<p class="muted">
									Generate a frame or video from the storyboard, or select another shot.
								</p>
							</div>{/each}
					</div>
				</div>
			{:else if tab === 'Sequence'}
				<div class="content stack">
					<div class="row">
						<h2>Sequence preview</h2>
						<span class="pill"
							>{accepted.filter((a) => a.job).length}/{project.shots.length} shots accepted</span
						><span class="spacer"></span><button
							disabled={!accepted.some((a) => a.job)}
							onclick={() => (playing = accepted.find((a) => a.job)?.shot.id ?? '')}
							>Play accepted sequence</button
						><a class="button" href={resolve('/api/director/[id]/export', { id: project.id })}
							>Export production bundle</a
						>
					</div>
					<p class="muted">
						Missing takes are skipped in preview and recorded as gaps in the export. Detailed timing
						and audio mixing belong in your finishing edit.
					</p>
					<div class="frame">
						{#if playing}{#key playing}<video
									controls
									autoplay
									src={media(accepted.find((a) => a.shot.id === playing)?.job?.fileIds?.[0] ?? '')}
									onended={nextVideo}><track kind="captions" /></video
								>{/key}{:else}<div class="placeholder">
								<span class="mark">▶</span>
								<p>Select a take below or play the sequence.</p>
							</div>{/if}
					</div>
					<div class="sequence">
						{#each accepted as item, i (item.shot.id)}<button
								disabled={!item.job}
								onclick={() => (playing = item.shot.id)}
								>{#if item.shot.firstFrame}<img
										src={media(item.shot.firstFrame)}
										alt={item.shot.title}
									/>{:else}<span class="gap">{item.job ? 'Ready' : 'Missing take'}</span>{/if}<span
									>{String(i + 1).padStart(2, '0')} · {item.shot.title}</span
								><small>{item.shot.duration}s</small></button
							>{/each}
					</div>
				</div>
			{/if}
		</fieldset>
	</main>
	<footer class="topbar">
		<span class="muted"
			>{project.shots.length} shots · {project.shots.reduce((n, s) => n + s.duration, 0)}s planned</span
		><span class="spacer"></span><span class="muted"
			>{jobs.filter((j) => !terminal(j.state)).length} active jobs</span
		><a href={resolve('/media')}>Media library ↗</a>
	</footer>
</div>

<style>
	:global(body) {
		margin: 0;
	}
</style>
