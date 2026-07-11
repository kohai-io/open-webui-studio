<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import {
		buildLinearFlowDefinition,
		defaultLinearFlowDraft,
		linearFlowDraftFromRecord,
		type LinearFlowDraft
	} from '$lib/flows/linear';

	let { data } = $props();
	const initialData = untrack(() => data);

	type FlowSummary = (typeof data.flows)[number];
	type ExecutionSummary = (typeof data.executions)[number];
	type FlowRecord = NonNullable<typeof data.selectedFlow>;
	type NodeRecord = {
		nodeId: string;
		nodeType: string;
		nodeOrder: number;
		state: string;
		attempt: number;
		errorCode: string | null;
	};
	type ExecutionRecord = ExecutionSummary & {
		inputs: Record<string, string>;
		output?: unknown;
		nodes: NodeRecord[];
	};
	type FlowEvent = {
		sequence: number;
		eventType: 'execution' | 'node';
		nodeId: string | null;
		state: string | null;
		errorCode: string | null;
	};

	const initialDraft = initialData.selectedFlow
		? linearFlowDraftFromRecord(initialData.selectedFlow)
		: defaultLinearFlowDraft(initialData.models[0]?.id ?? '');
	let flows = $state<FlowSummary[]>([...initialData.flows]);
	let selectedId = $state<string | null>(initialData.selectedFlow?.id ?? null);
	let selectedFlow = $state<FlowRecord | null>(initialData.selectedFlow);
	let draft = $state<LinearFlowDraft>(
		initialDraft ?? {
			...defaultLinearFlowDraft(initialData.models[0]?.id ?? ''),
			name: initialData.selectedFlow?.name ?? '',
			description: initialData.selectedFlow?.description ?? ''
		}
	);
	let editable = $state(initialDraft !== null || initialData.selectedFlow === null);
	let executions = $state<ExecutionSummary[]>(
		initialData.selectedFlow
			? initialData.executions.filter(
					(execution) => execution.flowId === initialData.selectedFlow?.id
				)
			: []
	);
	let currentExecution = $state<ExecutionRecord | null>(null);
	let progress = $state<FlowEvent[]>([]);
	let runInput = $state('');
	let saving = $state(false);
	let running = $state(false);
	let deleting = $state(false);
	let message = $state('');
	let errorMessage = $state('');
	let eventSource: EventSource | null = null;

	const loginHref = resolve(`/auth/login?return=${encodeURIComponent(resolve('/flows'))}`);
	const activeStates = new Set(['queued', 'running', 'cancel_requested']);
	const terminalStates = new Set(['succeeded', 'failed', 'cancelled']);

	$effect(() => () => eventSource?.close());

	function flowUrl(id: string) {
		return resolve('/api/flows/[id]', { id });
	}

	function flowExecutionsUrl(id: string) {
		return resolve('/api/flows/[id]/executions', { id });
	}

	function executionUrl(id: string) {
		return resolve('/api/executions/[id]', { id });
	}

	async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
		const response = await fetch(url, init);
		if (!response.ok) {
			const body = (await response.json().catch(() => ({}))) as { error?: string };
			throw new Error(body.error ?? `request_failed_${response.status}`);
		}
		return (await response.json()) as T;
	}

	function clearNotice() {
		message = '';
		errorMessage = '';
	}

	function newFlow() {
		eventSource?.close();
		eventSource = null;
		selectedId = null;
		selectedFlow = null;
		draft = defaultLinearFlowDraft(data.models[0]?.id ?? '');
		editable = true;
		executions = [];
		currentExecution = null;
		progress = [];
		clearNotice();
	}

	async function selectFlow(id: string) {
		clearNotice();
		eventSource?.close();
		eventSource = null;
		try {
			const [flow, history] = await Promise.all([
				requestJson<FlowRecord>(flowUrl(id)),
				requestJson<{ items: ExecutionSummary[] }>(flowExecutionsUrl(id))
			]);
			selectedId = id;
			selectedFlow = flow;
			const parsed = linearFlowDraftFromRecord(flow);
			editable = parsed !== null;
			draft = parsed ?? {
				...defaultLinearFlowDraft(data.models[0]?.id ?? ''),
				name: flow.name,
				description: flow.description ?? ''
			};
			executions = history.items;
			currentExecution = null;
			progress = [];
		} catch (error) {
			errorMessage = publicError(error);
		}
	}

	async function saveFlow() {
		clearNotice();
		if (!editable) return;
		if (!draft.prompt.includes('{{node.input.output}}')) {
			errorMessage = 'Add {{node.input.output}} to the prompt template.';
			return;
		}
		saving = true;
		try {
			const creating = selectedFlow === null;
			const body = {
				...(selectedFlow ? { expectedRevision: selectedFlow.revision } : {}),
				name: draft.name,
				description: draft.description,
				definition: buildLinearFlowDefinition(draft)
			};
			const flow = await requestJson<FlowRecord>(
				selectedFlow ? flowUrl(selectedFlow.id) : resolve('/api/flows'),
				{
					method: selectedFlow ? 'PUT' : 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body)
				}
			);
			selectedId = flow.id;
			selectedFlow = flow;
			const summary: FlowSummary = flow;
			flows = [summary, ...flows.filter((item) => item.id !== flow.id)];
			if (creating) executions = [];
			message = creating ? 'Flow created.' : 'Flow saved.';
		} catch (error) {
			errorMessage = publicError(error);
		} finally {
			saving = false;
		}
	}

	async function deleteSelectedFlow() {
		if (!selectedFlow || !confirm(`Delete ${selectedFlow.name}?`)) return;
		clearNotice();
		deleting = true;
		try {
			const response = await fetch(flowUrl(selectedFlow.id), { method: 'DELETE' });
			if (!response.ok) {
				const body = (await response.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error ?? 'delete_failed');
			}
			flows = flows.filter((item) => item.id !== selectedFlow?.id);
			newFlow();
			message = 'Flow deleted.';
		} catch (error) {
			errorMessage = publicError(error);
		} finally {
			deleting = false;
		}
	}

	async function runFlow() {
		if (!selectedFlow || !editable) return;
		clearNotice();
		running = true;
		try {
			const execution = await requestJson<ExecutionRecord>(flowExecutionsUrl(selectedFlow.id), {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'idempotency-key': crypto.randomUUID()
				},
				body: JSON.stringify({ inputs: { request: runInput } })
			});
			currentExecution = execution;
			progress = [];
			executions = [execution, ...executions.filter((item) => item.id !== execution.id)];
			watchExecution(execution.id);
		} catch (error) {
			errorMessage = publicError(error);
			running = false;
		}
	}

	function watchExecution(id: string) {
		eventSource?.close();
		const source = new EventSource(resolve('/api/executions/[id]/events', { id }));
		eventSource = source;
		source.addEventListener('flow', (rawEvent) => {
			try {
				const event = JSON.parse((rawEvent as MessageEvent<string>).data) as FlowEvent;
				progress = [...progress.filter((item) => item.sequence !== event.sequence), event].sort(
					(a, b) => a.sequence - b.sequence
				);
				if (event.eventType === 'execution' && event.state && currentExecution) {
					currentExecution = {
						...currentExecution,
						state: event.state as ExecutionRecord['state'],
						errorCode: event.errorCode
					};
				}
				if (event.eventType === 'execution' && event.state && terminalStates.has(event.state)) {
					source.close();
					eventSource = null;
					void loadExecution(id);
				}
			} catch {
				errorMessage = 'Live progress could not be read.';
			}
		});
		source.onerror = () => {
			if (eventSource === source && currentExecution && activeStates.has(currentExecution.state))
				errorMessage = 'Live progress was interrupted. Reopen this execution to reconnect.';
		};
	}

	async function loadExecution(id: string) {
		try {
			const execution = await requestJson<ExecutionRecord>(executionUrl(id));
			currentExecution = execution;
			executions = [execution, ...executions.filter((item) => item.id !== id)];
			running = activeStates.has(execution.state);
			if (running) watchExecution(id);
		} catch (error) {
			errorMessage = publicError(error);
		}
	}

	async function cancelRun() {
		if (!currentExecution) return;
		clearNotice();
		try {
			currentExecution = await requestJson<ExecutionRecord>(
				resolve('/api/executions/[id]/cancel', { id: currentExecution.id }),
				{ method: 'POST' }
			);
			running = activeStates.has(currentExecution.state);
		} catch (error) {
			errorMessage = publicError(error);
		}
	}

	function nodeState(node: NodeRecord) {
		return (
			progress.filter((event) => event.nodeId === node.nodeId && event.state).at(-1)?.state ??
			node.state
		);
	}

	function formatOutput(value: unknown) {
		return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
	}

	function formatDate(value: number) {
		return new Date(value).toLocaleString();
	}

	function publicError(error: unknown) {
		const code = error instanceof Error ? error.message : 'internal_error';
		const labels: Record<string, string> = {
			authentication_required: 'Your session or execution credential has expired.',
			permission_denied: 'This account cannot perform that action.',
			not_found: 'That Flow or execution is no longer available.',
			validation_failed: 'Check the required fields and Flow values.',
			conflict: 'This Flow changed elsewhere. Reopen it before saving.',
			active_execution: 'Cancel or finish active runs before deleting this Flow.'
		};
		return labels[code] ?? 'Studio could not complete that Flow request.';
	}
</script>

<svelte:head>
	<title>Studio · Flows</title>
	<meta name="description" content="Build and run constrained text Flows" />
</svelte:head>

<main>
	<nav>
		<a class="brand" href={resolve('/')}>Studio</a>
		<a href={resolve('/agents')}>Agents</a>
		<a href={resolve('/media')}>Media</a>
		<a class="active" href={resolve('/flows')}>Flows</a>
		{#if data.authenticated}
			<form method="POST" action={resolve('/auth/logout')}><button>Sign out</button></form>
		{/if}
	</nav>

	<header class="page-header">
		<div>
			<p class="eyebrow">Text workflows</p>
			<h1>Flows</h1>
			<p class="lede">Build a linear text workflow, run it in Studio, and follow each node.</p>
		</div>
		{#if data.authenticated}<button class="primary" type="button" onclick={newFlow}>New flow</button
			>{/if}
	</header>

	{#if !data.authenticated}
		<section class="empty-state">
			<h2>Sign in to work with Flows.</h2>
			<a class="primary link" href={loginHref}>Sign in</a>
		</section>
	{:else}
		{#if data.state !== 'ready'}
			<p class="notice warning">
				Open WebUI models are unavailable. Existing Flow history remains visible.
			</p>
		{/if}
		{#if message}<p class="notice success" role="status">{message}</p>{/if}
		{#if errorMessage}<p class="notice error" role="alert">{errorMessage}</p>{/if}

		<div class="workspace">
			<aside>
				<section class="panel flow-list" aria-labelledby="saved-flows">
					<div class="panel-heading">
						<div>
							<p class="eyebrow">Library</p>
							<h2 id="saved-flows">Saved flows</h2>
						</div>
						<span>{flows.length}</span>
					</div>
					{#if flows.length === 0}
						<p class="muted">Create your first linear text Flow.</p>
					{:else}
						<div class="stack">
							{#each flows as flow (flow.id)}
								<button
									class:chosen={selectedId === flow.id}
									type="button"
									onclick={() => selectFlow(flow.id)}
								>
									<strong>{flow.name}</strong>
									<span>v{flow.currentVersion} · {formatDate(flow.updatedAt)}</span>
								</button>
							{/each}
						</div>
					{/if}
				</section>

				{#if selectedFlow}
					<section class="panel history" aria-labelledby="execution-history">
						<div class="panel-heading">
							<div>
								<p class="eyebrow">Runs</p>
								<h2 id="execution-history">History</h2>
							</div>
							<span>{executions.length}</span>
						</div>
						{#if executions.length === 0}
							<p class="muted">No runs yet.</p>
						{:else}
							<div class="stack">
								{#each executions as execution (execution.id)}
									<button type="button" onclick={() => loadExecution(execution.id)}>
										<strong class={`state-${execution.state}`}
											>{execution.state.replace('_', ' ')}</strong
										>
										<span>{formatDate(execution.createdAt)}</span>
									</button>
								{/each}
							</div>
						{/if}
					</section>
				{/if}
			</aside>

			<div class="main-column">
				<section class="panel editor" aria-labelledby="flow-editor">
					<div class="panel-heading">
						<div>
							<p class="eyebrow">{selectedFlow ? 'Editor' : 'New flow'}</p>
							<h2 id="flow-editor">{selectedFlow?.name ?? 'Linear text flow'}</h2>
						</div>
						{#if selectedFlow}
							<button
								class="danger-link"
								type="button"
								disabled={deleting}
								onclick={deleteSelectedFlow}>Delete</button
							>
						{/if}
					</div>

					{#if !editable}
						<div class="read-only">
							<h3>This Flow uses a graph outside the first editor.</h3>
							<p>Its history remains available. Create a new linear Flow to edit and run here.</p>
						</div>
					{:else}
						<form
							onsubmit={(event) => {
								event.preventDefault();
								void saveFlow();
							}}
						>
							<div class="two-fields">
								<label>Flow name<input bind:value={draft.name} required maxlength="120" /></label>
								<label
									>Model<select
										bind:value={draft.modelId}
										required
										disabled={data.models.length === 0}
									>
										<option value="" disabled>Select a model</option>
										{#each data.models as model (model.id)}<option value={model.id}
												>{model.name}</option
											>{/each}
									</select></label
								>
							</div>
							<label
								>Description<textarea bind:value={draft.description} rows="2" maxlength="1000"
								></textarea></label
							>
							<label
								>Prompt template<textarea
									bind:value={draft.prompt}
									rows="5"
									required
									maxlength="32768"></textarea>
								<small
									>Use <code>{'{{node.input.output}}'}</code> where the run input should appear.</small
								>
							</label>
							<label
								>Optional transform<select bind:value={draft.transform}>
									<option value="none">None</option>
									<option value="trim">Trim whitespace</option>
									<option value="uppercase">Uppercase</option>
									<option value="lowercase">Lowercase</option>
								</select></label
							>

							<div class="flow-strip" aria-label="Flow structure">
								<span>Input</span><i>→</i><span>Model</span>{#if draft.transform !== 'none'}<i>→</i
									><span>{draft.transform}</span>{/if}<i>→</i><span>Output</span>
							</div>

							<div class="form-actions">
								<button class="primary" type="submit" disabled={saving || data.models.length === 0}
									>{saving ? 'Saving…' : selectedFlow ? 'Save changes' : 'Create flow'}</button
								>
								{#if selectedFlow}<span>Revision {selectedFlow.revision}</span>{/if}
							</div>
						</form>
					{/if}
				</section>

				{#if selectedFlow && editable}
					<section class="panel runner" aria-labelledby="run-flow">
						<div class="panel-heading">
							<div>
								<p class="eyebrow">Execute</p>
								<h2 id="run-flow">Run this flow</h2>
							</div>
							{#if currentExecution}<strong class={`state-${currentExecution.state}`}
									>{currentExecution.state.replace('_', ' ')}</strong
								>{/if}
						</div>
						<label
							>Text input<textarea
								bind:value={runInput}
								rows="5"
								maxlength="16384"
								placeholder="Enter text for this run"></textarea></label
						>
						<div class="form-actions">
							<button
								class="primary"
								type="button"
								disabled={running || !runInput}
								onclick={runFlow}>{running ? 'Running…' : 'Run flow'}</button
							>
							{#if currentExecution && activeStates.has(currentExecution.state)}
								<button class="secondary" type="button" onclick={cancelRun}>Cancel run</button>
							{/if}
							<span>Save editor changes before running.</span>
						</div>

						{#if currentExecution}
							<div class="node-list" aria-label="Execution nodes">
								{#each currentExecution.nodes as node (node.nodeId)}
									<div>
										<span class="node-order">{node.nodeOrder}</span>
										<strong>{node.nodeType}</strong>
										<em class={`state-${nodeState(node)}`}>{nodeState(node)}</em>
									</div>
								{/each}
							</div>
							{#if currentExecution.state === 'succeeded'}
								<div class="result">
									<p class="eyebrow">Output</p>
									<pre>{formatOutput(currentExecution.output)}</pre>
								</div>
							{:else if currentExecution.errorCode}
								<p class="notice error">
									Run ended with {currentExecution.errorCode.replaceAll('_', ' ')}.
								</p>
							{/if}
						{/if}
					</section>
				{/if}
			</div>
		</div>
	{/if}
</main>

<style>
	:global(*) {
		box-sizing: border-box;
	}
	:global(body) {
		margin: 0;
		min-width: 320px;
		background:
			radial-gradient(circle at 82% 2%, rgba(110, 231, 183, 0.12), transparent 32rem), #0b0d10;
		color: #f5f7f8;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}
	main {
		width: min(88rem, calc(100% - 3rem));
		margin: auto;
		padding: 1.5rem 0 5rem;
	}
	nav {
		display: flex;
		align-items: center;
		gap: 1.25rem;
	}
	nav a,
	nav button {
		border: 0;
		background: none;
		color: #aeb6bf;
		font: inherit;
		text-decoration: none;
		cursor: pointer;
	}
	.brand {
		margin-right: auto;
		color: #f5f7f8;
		font-weight: 750;
	}
	nav .active {
		color: #6ee7b7;
	}
	.page-header {
		display: flex;
		align-items: end;
		justify-content: space-between;
		gap: 2rem;
		padding: clamp(3.5rem, 8vh, 6rem) 0 2rem;
	}
	.eyebrow {
		margin: 0;
		color: #6ee7b7;
		font-size: 0.7rem;
		font-weight: 750;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0.35rem 0 0.7rem;
		font-size: clamp(3.5rem, 9vw, 7rem);
		letter-spacing: -0.07em;
		line-height: 0.95;
	}
	h2 {
		margin: 0.25rem 0 0;
		font-size: 1.35rem;
		letter-spacing: -0.025em;
	}
	h3 {
		margin: 0 0 0.5rem;
	}
	.lede,
	.muted,
	small,
	.form-actions span,
	.read-only p {
		color: #929ca7;
	}
	.workspace {
		display: grid;
		grid-template-columns: minmax(15rem, 22rem) minmax(0, 1fr);
		gap: 1rem;
		align-items: start;
	}
	aside,
	.main-column {
		display: grid;
		gap: 1rem;
	}
	.panel {
		border: 1px solid #252d35;
		border-radius: 1rem;
		background: rgba(17, 21, 26, 0.94);
		padding: 1.2rem;
	}
	.panel-heading {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}
	.panel-heading > span {
		color: #7f8a95;
	}
	.stack {
		display: grid;
		gap: 0.45rem;
	}
	.stack button {
		display: flex;
		width: 100%;
		justify-content: space-between;
		gap: 0.8rem;
		padding: 0.8rem;
		border: 1px solid transparent;
		border-radius: 0.7rem;
		background: #0c1014;
		color: #f5f7f8;
		text-align: left;
		cursor: pointer;
	}
	.stack button span {
		color: #7f8a95;
		font-size: 0.75rem;
		white-space: nowrap;
	}
	.stack button.chosen {
		border-color: #4d8b73;
		background: #13231d;
	}
	.editor form,
	.runner {
		display: grid;
		gap: 1rem;
	}
	label {
		display: grid;
		gap: 0.45rem;
		color: #c7ced5;
		font-size: 0.85rem;
	}
	input,
	textarea,
	select {
		width: 100%;
		border: 1px solid #303944;
		border-radius: 0.7rem;
		background: #0b0f13;
		color: #f5f7f8;
		padding: 0.75rem 0.85rem;
		font: inherit;
	}
	textarea {
		resize: vertical;
		line-height: 1.5;
	}
	input:focus,
	textarea:focus,
	select:focus {
		outline: 2px solid #4d8b73;
		outline-offset: 1px;
	}
	.two-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	.form-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.primary,
	.secondary {
		border: 0;
		border-radius: 999px;
		padding: 0.72rem 1rem;
		font: inherit;
		font-weight: 750;
		cursor: pointer;
	}
	.primary {
		background: #6ee7b7;
		color: #082a1d;
	}
	.primary.link {
		display: inline-block;
		text-decoration: none;
	}
	.secondary {
		background: #303944;
		color: #f5f7f8;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.danger-link {
		border: 0;
		background: none;
		color: #ff9da8;
		cursor: pointer;
	}
	.flow-strip {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		overflow-x: auto;
		padding: 1rem;
		border-radius: 0.75rem;
		background: #0a0d10;
	}
	.flow-strip span {
		padding: 0.55rem 0.75rem;
		border: 1px solid #34413c;
		border-radius: 0.55rem;
		color: #dffcef;
		text-transform: capitalize;
		white-space: nowrap;
	}
	.flow-strip i {
		color: #6ee7b7;
		font-style: normal;
	}
	.node-list {
		display: grid;
		gap: 0.5rem;
	}
	.node-list > div {
		display: grid;
		grid-template-columns: 2rem 1fr auto;
		align-items: center;
		gap: 0.7rem;
		padding: 0.7rem;
		border-radius: 0.65rem;
		background: #0b0f13;
		text-transform: capitalize;
	}
	.node-order {
		display: grid;
		width: 1.7rem;
		height: 1.7rem;
		place-items: center;
		border-radius: 50%;
		background: #23302a;
		color: #6ee7b7;
		font-size: 0.75rem;
	}
	em {
		font-style: normal;
		font-size: 0.75rem;
	}
	.state-succeeded {
		color: #6ee7b7 !important;
	}
	.state-running,
	.state-queued {
		color: #f8d477 !important;
	}
	.state-failed,
	.state-cancelled,
	.state-cancel_requested {
		color: #ff9da8 !important;
	}
	.result {
		margin-top: 0.5rem;
		padding: 1rem;
		border: 1px solid #294b3e;
		border-radius: 0.75rem;
		background: #0b1712;
	}
	pre {
		margin: 0.7rem 0 0;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font:
			0.9rem/1.5 ui-monospace,
			SFMono-Regular,
			Consolas,
			monospace;
	}
	.notice {
		padding: 0.8rem 1rem;
		border: 1px solid #303944;
		border-radius: 0.75rem;
	}
	.notice.warning {
		background: #29220f;
		color: #f8d477;
	}
	.notice.success {
		background: #0d2118;
		color: #8ef0c7;
	}
	.notice.error {
		border-color: #743b45;
		background: #2b171b;
		color: #ffc5cc;
	}
	.empty-state,
	.read-only {
		padding: 2rem;
		border: 1px solid #252d35;
		border-radius: 1rem;
		background: #11151a;
	}
	code {
		color: #a7f3d0;
	}
	@media (max-width: 820px) {
		main {
			width: min(100% - 2rem, 88rem);
		}
		.workspace {
			grid-template-columns: 1fr;
		}
		aside {
			grid-template-columns: 1fr 1fr;
		}
		.page-header {
			align-items: start;
		}
	}
	@media (max-width: 600px) {
		nav {
			gap: 0.75rem;
			flex-wrap: wrap;
		}
		.brand {
			width: 100%;
		}
		.page-header {
			align-items: stretch;
			flex-direction: column;
		}
		aside,
		.two-fields {
			grid-template-columns: 1fr;
		}
		.panel {
			padding: 1rem;
		}
	}
</style>
