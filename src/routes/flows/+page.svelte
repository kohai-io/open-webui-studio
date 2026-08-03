<script lang="ts">
	import { resolve } from '$app/paths';
	import { untrack } from 'svelte';
	import { buildLinearFlowDefinition, defaultLinearFlowDraft } from '$lib/flows/linear';
	import { nodeExecutionStateMap } from '$lib/flows/execution-state';
	import {
		addFlowNode,
		addFlowNodeAfter,
		connectFlowNodes,
		flowEditorIssues,
		moveFlowNode,
		removeFlowEdge,
		removeFlowNode,
		replaceFlowNode,
		type AdmittedFlowNodeType
	} from '$lib/flows/editor';
	import {
		commitFlowEditorHistory,
		createFlowEditorHistory,
		redoFlowEditorHistory,
		undoFlowEditorHistory
	} from '$lib/flows/history';
	import { autoLayoutFlowDefinition } from '$lib/flows/layout';
	import type { FlowDefinitionV1, FlowNodeV1, FlowPositionV1 } from '$lib/flows/types';
	import type { Connection } from '@xyflow/svelte';
	import FlowCanvas from '$lib/components/flows/FlowCanvas.svelte';
	import FlowNodeConfig from '$lib/components/flows/FlowNodeConfig.svelte';

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

	const starterDefinition = buildLinearFlowDefinition(
		defaultLinearFlowDraft(initialData.models[0]?.id ?? '')
	);
	const initialDefinition = initialData.selectedFlow?.definition ?? starterDefinition;
	let flows = $state<FlowSummary[]>([...initialData.flows]);
	let selectedId = $state<string | null>(initialData.selectedFlow?.id ?? null);
	let selectedFlow = $state<FlowRecord | null>(initialData.selectedFlow);
	let flowName = $state(initialData.selectedFlow?.name ?? '');
	let flowDescription = $state(initialData.selectedFlow?.description ?? '');
	let editorHistory = $state.raw(createFlowEditorHistory(initialDefinition));
	let definition = $derived(editorHistory.present);
	let executions = $state<ExecutionSummary[]>(
		initialData.selectedFlow
			? initialData.executions.filter(
					(execution) => execution.flowId === initialData.selectedFlow?.id
				)
			: []
	);
	let currentExecution = $state<ExecutionRecord | null>(null);
	let progress = $state<FlowEvent[]>([]);
	let runInputs = $state<Record<string, string>>(initialRuntimeInputs(initialDefinition));
	let saving = $state(false);
	let running = $state(false);
	let deleting = $state(false);
	let message = $state('');
	let errorMessage = $state('');
	let eventSource: EventSource | null = null;
	let selectedNodeId = $state<string | null>(
		initialDefinition.nodes.find((node) => node.type === 'model')?.id ??
			initialDefinition.nodes[0]?.id ??
			null
	);
	let selectedEdgeId = $state<string | null>(null);
	let graphIssues = $derived(flowEditorIssues(definition));
	let canUndo = $derived(editorHistory.past.length > 0);
	let canRedo = $derived(editorHistory.future.length > 0);
	let selectedNode = $derived(definition.nodes.find((node) => node.id === selectedNodeId) ?? null);
	let predecessorIds = $derived(
		selectedNodeId
			? definition.edges.filter((edge) => edge.target === selectedNodeId).map((edge) => edge.source)
			: []
	);
	let hasRunInput = $derived(
		(selectedFlow?.definition.nodes ?? [])
			.filter((node) => node.type === 'input')
			.every(
				(node) =>
					typeof runInputs[node.config.key] === 'string' &&
					(runInputs[node.config.key].length > 0 || node.config.defaultValue !== undefined)
			)
	);
	let executionByNodeId = $derived.by(() =>
		nodeExecutionStateMap(currentExecution?.nodes ?? [], progress)
	);

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

	function resetEditorDefinition(value: FlowDefinitionV1) {
		editorHistory = createFlowEditorHistory(value);
	}

	function applyEditorDefinition(value: FlowDefinitionV1) {
		editorHistory = commitFlowEditorHistory(editorHistory, value);
	}

	function newFlow() {
		eventSource?.close();
		eventSource = null;
		selectedId = null;
		selectedFlow = null;
		flowName = '';
		flowDescription = '';
		resetEditorDefinition(
			buildLinearFlowDefinition(defaultLinearFlowDraft(data.models[0]?.id ?? ''))
		);
		selectedNodeId = 'model';
		selectedEdgeId = null;
		executions = [];
		currentExecution = null;
		progress = [];
		runInputs = initialRuntimeInputs(definition);
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
			flowName = flow.name;
			flowDescription = flow.description ?? '';
			resetEditorDefinition(flow.definition);
			selectedNodeId =
				definition.nodes.find((node) => node.type === 'model')?.id ??
				definition.nodes[0]?.id ??
				null;
			selectedEdgeId = null;
			executions = history.items;
			currentExecution = null;
			progress = [];
			runInputs = initialRuntimeInputs(definition);
		} catch (error) {
			errorMessage = publicError(error);
		}
	}

	async function saveFlow() {
		clearNotice();
		if (graphIssues.length > 0) {
			errorMessage = graphIssues[0];
			return;
		}
		saving = true;
		try {
			const creating = selectedFlow === null;
			const body = {
				...(selectedFlow ? { expectedRevision: selectedFlow.revision } : {}),
				name: flowName,
				description: flowDescription,
				definition
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
			resetEditorDefinition(flow.definition);
			runInputs = initialRuntimeInputs(flow.definition, runInputs);
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
		if (!selectedFlow) return;
		clearNotice();
		running = true;
		try {
			const execution = await requestJson<ExecutionRecord>(flowExecutionsUrl(selectedFlow.id), {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'idempotency-key': crypto.randomUUID()
				},
				body: JSON.stringify({ inputs: runInputs })
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

	function selectCanvasNode(nodeId: string) {
		selectedNodeId = definition.nodes.some((node) => node.id === nodeId) ? nodeId : null;
		selectedEdgeId = null;
	}

	function selectCanvasEdge(edgeId: string) {
		selectedEdgeId = definition.edges.some((edge) => edge.id === edgeId) ? edgeId : null;
		selectedNodeId = null;
	}

	function clearCanvasSelection() {
		selectedNodeId = null;
		selectedEdgeId = null;
	}

	function updateCanvasPosition(nodeId: string, position: FlowPositionV1) {
		applyEditorDefinition(moveFlowNode(definition, nodeId, position));
	}

	function addCanvasNode(type: AdmittedFlowNodeType, sourceNodeId: string | null) {
		clearNotice();
		if (sourceNodeId && type !== 'input') {
			const guided = addFlowNodeAfter(definition, sourceNodeId, type, data.models[0]?.id ?? '');
			if (!guided) {
				errorMessage = unavailableNodeMessage(type);
				return;
			}
			if (guided.error) {
				errorMessage = guided.error;
				return;
			}
			applyEditorDefinition(guided.definition);
			selectedNodeId = guided.nodeId;
			selectedEdgeId = null;
			return;
		}
		const result = addFlowNode(definition, type, data.models[0]?.id ?? '');
		if (!result) {
			errorMessage = unavailableNodeMessage(type);
			return;
		}
		applyEditorDefinition(result.definition);
		selectedNodeId = result.nodeId;
		selectedEdgeId = null;
	}

	function unavailableNodeMessage(type: AdmittedFlowNodeType): string {
		return type === 'output'
			? 'A Flow can contain exactly one Output node.'
			: 'This Flow has reached the node limit.';
	}

	function connectCanvasNodes(connection: Connection) {
		clearNotice();
		const result = connectFlowNodes(definition, connection);
		if (result.error) {
			errorMessage = result.error;
			return;
		}
		applyEditorDefinition(result.definition);
	}

	function updateCanvasNode(node: FlowNodeV1) {
		applyEditorDefinition(replaceFlowNode(definition, node));
	}

	function deleteCanvasNode(nodeId: string) {
		const node = definition.nodes.find((candidate) => candidate.id === nodeId);
		if (!node || !confirm(`Delete ${node.id}?`)) return;
		applyEditorDefinition(removeFlowNode(definition, nodeId));
		clearCanvasSelection();
	}

	function deleteCanvasEdge(edgeId: string) {
		applyEditorDefinition(removeFlowEdge(definition, edgeId));
		selectedEdgeId = null;
	}

	function autoLayoutCanvas() {
		clearNotice();
		applyEditorDefinition(autoLayoutFlowDefinition(definition));
	}

	function undoCanvasChange() {
		const nextHistory = undoFlowEditorHistory(editorHistory);
		if (nextHistory === editorHistory) return;
		editorHistory = nextHistory;
		reconcileCanvasSelection();
		clearNotice();
	}

	function redoCanvasChange() {
		const nextHistory = redoFlowEditorHistory(editorHistory);
		if (nextHistory === editorHistory) return;
		editorHistory = nextHistory;
		reconcileCanvasSelection();
		clearNotice();
	}

	function reconcileCanvasSelection() {
		if (selectedNodeId && !definition.nodes.some((node) => node.id === selectedNodeId))
			selectedNodeId = null;
		if (selectedEdgeId && !definition.edges.some((edge) => edge.id === selectedEdgeId))
			selectedEdgeId = null;
	}

	function handleEditorKeydown(event: KeyboardEvent) {
		if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
		const target = event.target;
		if (
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement ||
			(target instanceof HTMLElement && target.isContentEditable)
		)
			return;
		const key = event.key.toLocaleLowerCase();
		if (key === 'z' && event.shiftKey) {
			event.preventDefault();
			redoCanvasChange();
		} else if (key === 'z') {
			event.preventDefault();
			undoCanvasChange();
		} else if (key === 'y') {
			event.preventDefault();
			redoCanvasChange();
		}
	}

	function initialRuntimeInputs(
		value: FlowDefinitionV1,
		existing: Record<string, string> = {}
	): Record<string, string> {
		return Object.fromEntries(
			value.nodes
				.filter((node) => node.type === 'input')
				.map((node) => [
					node.config.key,
					existing[node.config.key] ?? node.config.defaultValue ?? ''
				])
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

<svelte:window onkeydown={handleEditorKeydown} />

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
			<p class="lede">Build a text graph, configure it on the canvas, and follow each node.</p>
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
						<p class="muted">Create your first text Flow.</p>
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
				<section class="panel editor canvas-first" aria-labelledby="flow-editor">
					<div class="panel-heading">
						<div>
							<p class="eyebrow">{selectedFlow ? 'Editor' : 'New flow'}</p>
							<h2 id="flow-editor">{selectedFlow?.name ?? 'Text flow'}</h2>
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

					<form
						onsubmit={(event) => {
							event.preventDefault();
							void saveFlow();
						}}
					>
						<div class="flow-metadata">
							<label>Flow name<input bind:value={flowName} required maxlength="120" /></label>
							<label
								>Description<textarea bind:value={flowDescription} rows="1" maxlength="1000"
								></textarea></label
							>
							<div class="form-actions">
								<button class="primary" type="submit" disabled={saving}
									>{saving ? 'Saving…' : selectedFlow ? 'Save changes' : 'Create flow'}</button
								>
								{#if selectedFlow}<span>Revision {selectedFlow.revision}</span>{/if}
							</div>
						</div>

						{#if graphIssues.length > 0}
							<div class="graph-feedback" role="status">
								<strong>Finish wiring this Flow</strong>
								<span>{graphIssues[0]}</span>
							</div>
						{/if}

						<div class="canvas-editor">
							<FlowCanvas
								{definition}
								{executionByNodeId}
								{selectedNodeId}
								{selectedEdgeId}
								onselect={selectCanvasNode}
								onselectedge={selectCanvasEdge}
								onclearselection={clearCanvasSelection}
								onpositionchange={updateCanvasPosition}
								onconnectnodes={connectCanvasNodes}
								onaddnode={addCanvasNode}
								ondeleteedge={deleteCanvasEdge}
								onautolayout={autoLayoutCanvas}
								onundo={undoCanvasChange}
								onredo={redoCanvasChange}
								{canUndo}
								{canRedo}
							/>
							{#if selectedNode}
								<div class="node-config-overlay">
									<FlowNodeConfig
										node={selectedNode}
										models={data.models}
										{predecessorIds}
										onupdate={updateCanvasNode}
										ondelete={deleteCanvasNode}
										onclose={clearCanvasSelection}
									/>
								</div>
							{/if}
						</div>
					</form>
				</section>

				{#if selectedFlow}
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
						<div class="run-inputs">
							{#each selectedFlow.definition.nodes.filter((node) => node.type === 'input') as node (node.id)}
								<label
									>{node.config.key}<textarea
										bind:value={runInputs[node.config.key]}
										rows="4"
										maxlength="16384"
										placeholder={node.config.defaultValue ?? 'Enter text for this input'}
									></textarea></label
								>
							{/each}
						</div>
						<div class="form-actions">
							<button
								class="primary"
								type="button"
								disabled={running || !hasRunInput}
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
		width: min(110rem, calc(100% - 3rem));
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
	.lede,
	.muted,
	.form-actions span {
		color: #929ca7;
	}
	.workspace {
		display: grid;
		grid-template-columns: minmax(14rem, 18rem) minmax(0, 1fr);
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
	textarea {
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
	textarea:focus {
		outline: 2px solid #4d8b73;
		outline-offset: 1px;
	}
	.flow-metadata {
		display: grid;
		grid-template-columns: minmax(12rem, 0.8fr) minmax(16rem, 1.4fr) auto;
		gap: 1rem;
		align-items: end;
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
	.canvas-editor {
		position: relative;
	}
	.node-config-overlay {
		position: absolute;
		z-index: 5;
		top: 1rem;
		right: 1rem;
		bottom: 1rem;
	}
	.graph-feedback {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.65rem 0.85rem;
		border: 1px solid #64562d;
		border-radius: 0.7rem;
		background: #29220f;
		color: #f8d477;
		font-size: 0.78rem;
	}
	.graph-feedback span {
		color: #c8b775;
	}
	.run-inputs {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
		gap: 1rem;
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
	.empty-state {
		padding: 2rem;
		border: 1px solid #252d35;
		border-radius: 1rem;
		background: #11151a;
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
		.flow-metadata {
			grid-template-columns: 1fr 1fr;
		}
		.flow-metadata .form-actions {
			grid-column: 1 / -1;
		}
		.node-config-overlay {
			top: auto;
			left: 1rem;
			max-height: 70%;
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
		.flow-metadata {
			grid-template-columns: 1fr;
		}
		.flow-metadata .form-actions {
			grid-column: auto;
		}
		.panel {
			padding: 1rem;
		}
	}
</style>
