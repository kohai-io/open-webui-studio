<script lang="ts">
	import { flowExecutionErrorMessage } from '$lib/flows/errors';
	import { appendImageEdit, imageFlowDefinition } from '$lib/flows/image';
	import { isFlowImages, type FlowInputValue } from '$lib/flows/types';
	import ImageInput from '$lib/components/flows/ImageInput.svelte';
	import ImageOutput from '$lib/components/flows/ImageOutput.svelte';
	import { resolve } from '$app/paths';
	import { onMount, tick, untrack } from 'svelte';
	import { imageCapabilityMessage, type ImageCapabilities } from '$lib/flows/capabilities';
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
		payload?: unknown;
		nodeId: string;
		nodeType: string;
		nodeOrder: number;
		state: string;
		attempt: number;
		errorCode: string | null;
	};
	type ExecutionRecord = ExecutionSummary & {
		inputs: Record<string, FlowInputValue>;
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
	let runInputs = $state<Record<string, FlowInputValue>>(initialRuntimeInputs(initialDefinition));
	let saving = $state(false);
	let preparing = $state(false);
	let panelTab = $state<'inputs' | 'results' | 'history' | 'node'>('inputs');
	let leftPanel = $state<'library' | 'details' | null>('library');
	let runPanelOpen = $state(true);
	let narrowViewport = $state(false);
	async function focusField(selector: string) {
		await tick();
		const field = document.querySelector<HTMLElement>(selector);
		const panel = field?.closest('.floating-panel');
		await Promise.all(
			panel?.getAnimations().map((animation) => animation.finished.catch(() => {})) ?? []
		);
		if (field?.isConnected && !field.closest('[inert]')) field.focus();
	}
	function focusControl(id: string) {
		document.getElementById(id)?.focus();
	}
	function closeLeftPanel() {
		const id = leftPanel === 'details' ? 'details-toggle' : 'library-toggle';
		leftPanel = null;
		focusControl(id);
	}
	function toggleLeftPanel(panel: 'library' | 'details') {
		if (leftPanel === panel) {
			closeLeftPanel();
			return;
		}
		leftPanel = panel;
		if (narrowViewport) runPanelOpen = false;
	}
	function closeRunPanel() {
		runPanelOpen = false;
		focusControl('run-panel-toggle');
	}
	function toggleRunPanel() {
		if (runPanelOpen) {
			closeRunPanel();
			return;
		}
		runPanelOpen = true;
		if (narrowViewport) leftPanel = null;
	}
	function revealRunPanel() {
		runPanelOpen = true;
		if (narrowViewport) leftPanel = null;
	}

	let capabilities = $state<ImageCapabilities | null>(null);
	let checkingCapabilities = $state(false);
	let dirty = $derived(
		!selectedFlow ||
			flowName !== selectedFlow.name ||
			flowDescription !== (selectedFlow.description ?? '') ||
			JSON.stringify(definition) !== JSON.stringify(selectedFlow.definition)
	);
	let imageOperations = $derived([
		...new Set(
			definition.nodes.filter((node) => node.type === 'image').map((node) => node.config.operation)
		)
	]);
	let imageBlocked = $derived(
		imageOperations.some(
			(operation) =>
				capabilities &&
				['disabled', 'permission_denied', 'unavailable'].includes(capabilities[operation])
		)
	);
	let canAppendEdit = $derived(appendImageEdit(definition) !== null);
	onMount(() => {
		if (data.authenticated) void checkCapabilities();
		const media = window.matchMedia('(max-width: 800px)');
		const resize = () => {
			narrowViewport = media.matches;
			if (media.matches && runPanelOpen) leftPanel = null;
		};
		resize();
		media.addEventListener('change', resize);
		return () => media.removeEventListener('change', resize);
	});
	async function checkCapabilities() {
		checkingCapabilities = true;
		try {
			capabilities = await requestJson<ImageCapabilities>(resolve('/api/flow-capabilities'));
		} catch {
			capabilities = { generate: 'unavailable', edit: 'unavailable', canManage: false };
		} finally {
			checkingCapabilities = false;
		}
		return capabilities;
	}
	function useResultAsReference(id: string) {
		if (running || preparing || saving || pendingUploads > 0) return;
		newFlow('edit');
		flowName = 'Edit generated image';
		runInputs = { prompt: '', images: { kind: 'images', fileIds: [id] } };
		revealRunPanel();
		panelTab = 'inputs';
		void focusField('#flow-run-panel textarea');
		message = 'Reference added to a new edit flow. Describe your changes and save and run.';
	}
	function addResultEditStep() {
		if (running || preparing || saving || pendingUploads > 0) return;
		const result = appendImageEdit(definition);
		if (!result) return;
		applyEditorDefinition(result.definition);
		selectedNodeId = result.nodeId;
		panelTab = 'node';
		revealRunPanel();
		void focusField('.node-config-dock select');
		message = 'Edit step added. Set its prompt, then save and run. Earlier steps will run again.';
	}

	let pendingUploads = $state(0);
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
		definition.nodes
			.filter((node) => node.type === 'input')
			.every((node) =>
				node.config.kind === 'images'
					? isFlowImages(runInputs[node.config.key])
					: (typeof runInputs[node.config.key] === 'string' &&
							(runInputs[node.config.key] as string).trim().length > 0) ||
						Boolean(node.config.defaultValue?.trim())
			)
	);
	let executionByNodeId = $derived.by(() =>
		nodeExecutionStateMap(
			!dirty && currentExecution?.flowVersion === selectedFlow?.currentVersion
				? (currentExecution?.nodes ?? [])
				: [],
			!dirty && currentExecution?.flowVersion === selectedFlow?.currentVersion ? progress : []
		)
	);

	const imageSettingsUrl = '/admin/settings/images';
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
		if (running || preparing || saving) return;
		editorHistory = commitFlowEditorHistory(editorHistory, value);
	}

	function newFlow(kind: 'text' | 'generate' | 'edit' = 'text') {
		if (pendingUploads > 0 || preparing || saving || running) return;
		eventSource?.close();
		eventSource = null;
		panelTab = 'inputs';
		leftPanel = 'details';
		runPanelOpen = !narrowViewport;
		selectedId = null;
		selectedFlow = null;
		flowName = '';
		flowDescription = '';
		resetEditorDefinition(
			kind === 'text'
				? buildLinearFlowDefinition(defaultLinearFlowDraft(data.models[0]?.id ?? ''))
				: imageFlowDefinition(kind)
		);
		selectedNodeId = kind === 'text' ? 'model' : 'image';
		selectedEdgeId = null;
		executions = [];
		currentExecution = null;
		progress = [];
		runInputs = initialRuntimeInputs(definition);
		void focusField('#flow-details input');
		clearNotice();
	}

	async function selectFlow(id: string) {
		if (pendingUploads > 0 || preparing || saving || running) return;
		clearNotice();
		eventSource?.close();
		eventSource = null;
		try {
			const [flow, history] = await Promise.all([
				requestJson<FlowRecord>(flowUrl(id)),
				requestJson<{ items: ExecutionSummary[] }>(flowExecutionsUrl(id))
			]);
			panelTab = 'inputs';
			leftPanel = null;
			revealRunPanel();
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

	async function saveFlow(): Promise<FlowRecord | null> {
		if (pendingUploads > 0 || saving || running) return null;
		clearNotice();
		if (graphIssues.length > 0) {
			errorMessage = graphIssues[0];
			return null;
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
			if (creating) {
				executions = [];
				panelTab = 'inputs';
			}
			if (narrowViewport) {
				revealRunPanel();
				if (!preparing) void focusField('#flow-run-panel textarea, #flow-run-panel input');
			}
			message = creating ? 'Flow created.' : 'Flow saved.';
			return flow;
		} catch (error) {
			errorMessage = publicError(error);
			return null;
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
		if (
			pendingUploads > 0 ||
			running ||
			preparing ||
			saving ||
			!hasRunInput ||
			!flowName.trim() ||
			graphIssues.length
		)
			return;
		clearNotice();
		preparing = true;
		try {
			if (imageOperations.length) {
				const checked = await checkCapabilities();
				const blocked = imageOperations.find((operation) =>
					['disabled', 'permission_denied', 'unavailable'].includes(checked[operation])
				);
				if (blocked) {
					errorMessage = imageCapabilityMessage(blocked, checked[blocked]);
					panelTab = 'inputs';
					return;
				}
			}
			const flow = dirty ? await saveFlow() : selectedFlow;
			if (!flow) return;
			const execution = await requestJson<ExecutionRecord>(flowExecutionsUrl(flow.id), {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
				body: JSON.stringify({
					inputs: initialRuntimeInputs(flow.definition, runInputs),
					flowVersion: flow.currentVersion
				})
			});
			currentExecution = execution;
			progress = [];
			executions = [execution, ...executions.filter((item) => item.id !== execution.id)];
			running = true;
			panelTab = 'results';
			revealRunPanel();
			watchExecution(execution.id);
		} catch (error) {
			errorMessage = publicError(error);
		} finally {
			preparing = false;
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
			if (selectedFlow) runInputs = initialRuntimeInputs(selectedFlow.definition, execution.inputs);
			currentExecution = execution;
			panelTab = 'results';
			revealRunPanel();
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
		panelTab = 'node';
		revealRunPanel();
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
		if (running || preparing || saving) return;
		const nextHistory = undoFlowEditorHistory(editorHistory);
		if (nextHistory === editorHistory) return;
		editorHistory = nextHistory;
		reconcileCanvasSelection();
		clearNotice();
	}

	function redoCanvasChange() {
		if (running || preparing || saving) return;
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
		const focused = event.target;
		if (
			(event.key === 'Enter' || event.key === ' ') &&
			focused instanceof HTMLElement &&
			focused.matches('.svelte-flow__node')
		) {
			const id = focused.dataset.id;
			if (id) {
				event.preventDefault();
				selectCanvasNode(id);
				void focusField(
					'.node-config-dock input, .node-config-dock select, .node-config-dock textarea'
				);
			}
			return;
		}
		if (event.key === 'Escape' && !event.defaultPrevented) {
			const target = event.target;
			if (target instanceof HTMLElement && target.closest('dialog[open], .node-picker')) return;
			if (target instanceof HTMLElement && target.closest('.studio-menu')) {
				target.closest('details')?.removeAttribute('open');
				(target.closest('details')?.querySelector('summary') as HTMLElement)?.focus();
				return;
			}
			if (target instanceof HTMLElement && target.closest('.left-panel')) closeLeftPanel();
			else if (runPanelOpen) closeRunPanel();
			else if (leftPanel) closeLeftPanel();
			return;
		}
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
		existing: Record<string, FlowInputValue> = {}
	): Record<string, FlowInputValue> {
		return Object.fromEntries(
			value.nodes
				.filter((node) => node.type === 'input')
				.map((node) => [
					node.config.key,
					node.config.kind === 'images'
						? isFlowImages(existing[node.config.key])
							? existing[node.config.key]
							: { kind: 'images', fileIds: [] }
						: typeof existing[node.config.key] === 'string'
							? existing[node.config.key]
							: (node.config.defaultValue ?? '')
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
	<meta name="description" content="Build and run text and image Flows" />
</svelte:head>

<main>
	<h1 class="sr-only">Flows</h1>
	{#if !data.authenticated}
		<section class="empty-state">
			<h2>Sign in to work with Flows.</h2>
			<a class="primary link" href={loginHref}>Sign in</a>
		</section>
	{:else}
		<div class="workspace" aria-label="Flow workspace">
			<div class="canvas-editor">
				<FlowCanvas
					onpickeropen={() => {
						if (narrowViewport) {
							leftPanel = null;
							runPanelOpen = false;
						}
					}}
					fullscreen
					locked={running || saving || preparing}
					leftInset={narrowViewport ? 24 : leftPanel ? 352 : 32}
					rightInset={narrowViewport ? 24 : runPanelOpen ? 384 : 32}
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
			</div>
			<header class="workspace-bar">
				<div class="workspace-navigation">
					<details class="studio-menu">
						<summary>Studio <span class="chevron" aria-hidden="true"></span></summary>
						<nav aria-label="Studio">
							<a href={resolve('/')}>Home</a><a href={resolve('/agents')}>Agents</a><a
								href={resolve('/media')}>Media</a
							>
							<form method="POST" action={resolve('/auth/logout')}><button>Sign out</button></form>
						</nav>
					</details>
					<button
						id="library-toggle"
						class="secondary disclosure"
						type="button"
						aria-expanded={leftPanel === 'library'}
						aria-controls="flow-library"
						onclick={() => toggleLeftPanel('library')}
						>Flows <span class="chevron" aria-hidden="true"></span></button
					>
					<button
						id="details-toggle"
						class="secondary disclosure flow-title"
						aria-label={`Flow details: ${flowName || 'Untitled flow'}`}
						type="button"
						aria-expanded={leftPanel === 'details'}
						aria-controls="flow-details"
						onclick={() => toggleLeftPanel('details')}
						><span>{flowName || 'Untitled flow'}</span><span class="details-label"
							>Flow details</span
						><span class="chevron" aria-hidden="true"></span></button
					>
				</div>
				<div class="workspace-actions">
					<div class="run-toolbar">
						<button
							class="primary"
							type="button"
							disabled={running ||
								preparing ||
								saving ||
								pendingUploads > 0 ||
								!hasRunInput ||
								!flowName.trim() ||
								graphIssues.length > 0 ||
								(imageOperations.length > 0 && checkingCapabilities) ||
								imageBlocked}
							onclick={runFlow}
							>{preparing
								? 'Preparing…'
								: running
									? 'Running…'
									: dirty
										? 'Save and run'
										: 'Run flow'}</button
						>
						{#if currentExecution && activeStates.has(currentExecution.state)}<button
								class="secondary"
								type="button"
								onclick={cancelRun}>Cancel run</button
							>{/if}
						<span class="save-state" role="status"
							>{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}</span
						>
					</div>
					<button
						id="run-panel-toggle"
						class="secondary disclosure"
						type="button"
						aria-expanded={runPanelOpen}
						aria-controls="flow-run-panel"
						onclick={toggleRunPanel}
						>Run panel <span class="chevron" aria-hidden="true"></span></button
					>
				</div>
			</header>
			<div class="canvas-notices" aria-label="Flow notifications">
				{#if data.state !== 'ready'}<p class="notice warning">
						Open WebUI models are unavailable. Existing Flow history remains visible.
					</p>{/if}
				{#if message}<div class="notice success">
						<span role="status">{message}</span><button
							class="icon-button"
							type="button"
							aria-label="Dismiss notification"
							onclick={() => (message = '')}>×</button
						>
					</div>{/if}
				{#if errorMessage}<div class="notice error">
						<span role="alert">{errorMessage}</span><button
							class="icon-button"
							type="button"
							aria-label="Dismiss error"
							onclick={() => (errorMessage = '')}>×</button
						>
					</div>{/if}
			</div>
			<section
				id="flow-library"
				class="panel flow-list floating-panel left-panel"
				class:is-open={leftPanel === 'library'}
				inert={leftPanel !== 'library'}
				aria-hidden={leftPanel !== 'library'}
				aria-labelledby="saved-flows"
			>
				<div class="panel-heading">
					<div>
						<p class="eyebrow">Library</p>
						<h2 id="saved-flows">Saved flows</h2>
					</div>
					<button
						class="icon-button"
						type="button"
						aria-label="Collapse flow library"
						onclick={() => closeLeftPanel()}>×</button
					>
				</div>
				<div class="form-actions">
					<button
						class="secondary"
						type="button"
						disabled={pendingUploads > 0 || running || preparing || saving}
						onclick={() => newFlow()}>New flow</button
					>
					<button
						class="secondary"
						type="button"
						disabled={pendingUploads > 0 || running || preparing || saving}
						onclick={() => newFlow('generate')}>New image flow</button
					><button
						type="button"
						class="secondary"
						disabled={pendingUploads > 0 || running || preparing || saving}
						onclick={() => newFlow('edit')}>New image edit flow</button
					>
				</div>
				{#if flows.length === 0}
					<p class="muted">Create your first Flow.</p>
				{:else}
					<div class="stack">
						{#each flows as flow (flow.id)}
							<button
								class:chosen={selectedId === flow.id}
								type="button"
								disabled={running || preparing || saving || pendingUploads > 0}
								onclick={() => selectFlow(flow.id)}
							>
								<strong>{flow.name}</strong>
								<span>v{flow.currentVersion} · {formatDate(flow.updatedAt)}</span>
							</button>
						{/each}
					</div>
				{/if}
			</section>
			<section
				id="flow-details"
				class="panel editor floating-panel left-panel"
				class:is-open={leftPanel === 'details'}
				inert={leftPanel !== 'details'}
				aria-hidden={leftPanel !== 'details'}
				aria-labelledby="flow-editor"
			>
				<div class="panel-heading">
					<div>
						<p class="eyebrow">{selectedFlow ? 'Editor' : 'New flow'}</p>
						<h2 id="flow-editor">{selectedFlow?.name ?? 'New flow'}</h2>
					</div>
					<button
						class="icon-button"
						type="button"
						aria-label="Collapse flow details"
						onclick={() => closeLeftPanel()}>×</button
					>
				</div>

				<form
					onsubmit={(event) => {
						event.preventDefault();
						void saveFlow();
					}}
				>
					<div class="flow-metadata">
						<label
							>Flow name<input
								disabled={running || saving || preparing}
								bind:value={flowName}
								required
								maxlength="120"
							/></label
						>
						<label
							>Description<textarea
								disabled={running || saving || preparing}
								bind:value={flowDescription}
								rows="1"
								maxlength="1000"></textarea></label
						>
						<div class="form-actions">
							{#if selectedFlow}
								<button
									class="danger-link"
									type="button"
									disabled={deleting || running || preparing || saving}
									onclick={deleteSelectedFlow}>Delete</button
								>
							{/if}
							<button
								class="secondary"
								type="submit"
								disabled={saving || preparing || running || pendingUploads > 0 || !dirty}
								>{saving ? 'Saving…' : selectedFlow ? 'Save changes' : 'Create flow'}</button
							>
							{#if selectedFlow}<span class="save-state"
									>{dirty ? 'Unsaved changes' : 'Saved'} · v{selectedFlow.currentVersion}</span
								>{/if}
						</div>
					</div>

					{#if graphIssues.length > 0}
						<div class="graph-feedback" role="status">
							<strong>Finish wiring this Flow</strong>
							<span>{graphIssues[0]}</span>
						</div>
					{/if}
				</form>
			</section>

			<section
				id="flow-run-panel"
				class="panel runner floating-panel right-panel"
				class:is-open={runPanelOpen}
				inert={!runPanelOpen}
				aria-hidden={!runPanelOpen}
				aria-labelledby="run-flow"
			>
				<div class="panel-heading">
					<div>
						<p class="eyebrow">Execute</p>
						<h2 id="run-flow">Run this flow</h2>
					</div>
					<button
						class="icon-button"
						type="button"
						aria-label="Collapse run panel"
						onclick={() => closeRunPanel()}>×</button
					>
					{#if currentExecution}<strong class={`state-${currentExecution.state}`}
							>{currentExecution.state.replace('_', ' ')}</strong
						>{/if}
				</div>

				{#if !flowName.trim()}<p class="muted">Name your flow to save and run.</p>{/if}
				<div class="panel-tabs" aria-label="Run panel views">
					{#each ['inputs', 'results', 'history', 'node'] as tab (tab)}
						<button
							type="button"
							aria-pressed={panelTab === tab}
							onclick={() => (panelTab = tab as typeof panelTab)}
							>{tab === 'node' ? 'Node' : tab[0].toUpperCase() + tab.slice(1)}</button
						>
					{/each}
				</div>
				<div class="panel-body">
					{#if imageOperations.length && panelTab === 'inputs'}
						<div class="readiness" aria-label="Image readiness">
							{#each imageOperations as operation (operation)}<p>
									{capabilities
										? imageCapabilityMessage(operation, capabilities[operation])
										: 'Checking image availability…'}
								</p>{/each}
							{#if capabilities?.canManage}<a
									href={imageSettingsUrl}
									target="_blank"
									rel="external noreferrer">Open image settings ↗</a
								>{/if}
							<button
								type="button"
								disabled={checkingCapabilities || preparing}
								onclick={() => checkCapabilities()}
								>{checkingCapabilities ? 'Checking…' : 'Check again'}</button
							>
						</div>
					{/if}
					{#if panelTab === 'inputs'}
						<div class="run-inputs">
							{#key selectedId ?? 'draft'}
								{#each definition.nodes.filter((node) => node.type === 'input') as node (node.id)}
									{#if node.config.kind === 'images'}
										<div>
											<p>{node.config.key}</p>
											<ImageInput
												value={runInputs[node.config.key]}
												disabled={running || preparing || saving}
												onchange={(value) => (runInputs[node.config.key] = value)}
												onbusy={(busy) => (pendingUploads += busy ? 1 : -1)}
											/>
										</div>
									{:else}<label
											>{node.config.key}<textarea
												value={typeof runInputs[node.config.key] === 'string'
													? (runInputs[node.config.key] as string)
													: ''}
												oninput={(event) =>
													(runInputs[node.config.key] = event.currentTarget.value)}
												rows="4"
												maxlength="16384"
												disabled={running || preparing || saving}
												placeholder={node.config.defaultValue ?? 'Enter text for this input'}
											></textarea></label
										>
									{/if}{/each}{/key}
						</div>
					{/if}

					{#if panelTab === 'history'}
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
										<button
											type="button"
											disabled={running || preparing || saving}
											onclick={() => loadExecution(execution.id)}
										>
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

					{#if panelTab === 'node' && selectedNode}
						<div class="node-config-dock" inert={running || saving || preparing}>
							<FlowNodeConfig
								node={selectedNode}
								models={data.models}
								{predecessorIds}
								onupdate={updateCanvasNode}
								ondelete={deleteCanvasNode}
								onclose={() => {
									clearCanvasSelection();
									closeRunPanel();
								}}
							/>
						</div>
					{/if}
					{#if panelTab === 'node' && !selectedNode}<p class="muted">
							Select a node on the canvas to edit its settings.
						</p>{/if}
					{#if panelTab === 'results' && !currentExecution}<p class="muted">
							Run your flow to see its progress and results here.
						</p>{/if}

					{#if currentExecution && panelTab === 'results'}
						<p class="muted">
							Flow version {currentExecution.flowVersion} · {formatDate(currentExecution.createdAt)}
						</p>
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
								{#each Object.entries(currentExecution.inputs) as [key, value] (key)}{#if isFlowImages(value)}<p
											class="eyebrow"
										>
											Reference · {key}
										</p>
										<ImageOutput {value} compact />{/if}{/each}
								<p class="eyebrow">Output</p>
								{#if isFlowImages(currentExecution.output)}<ImageOutput
										value={currentExecution.output}
										onuse={useResultAsReference}
										onedit={canAppendEdit ? addResultEditStep : undefined}
										disabled={running || preparing || saving || pendingUploads > 0 || dirty}
									/>{:else}<pre>{formatOutput(currentExecution.output)}</pre>{/if}
							</div>
						{:else if currentExecution.errorCode}
							<p class="notice error">
								{flowExecutionErrorMessage(currentExecution.errorCode)}
							</p>
						{/if}
					{/if}
				</div>
			</section>
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
		background: #0b0d10;
		color: #edf0f3;
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}
	main {
		--flow-control-height: 2.25rem;
		--flow-control-font: 0.875rem;
		--flow-label-font: 0.8125rem;
		--flow-help-font: 0.75rem;
		--flow-radius: 0.5rem;
		font-size: 0.875rem;
		line-height: 1.5;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.workspace {
		position: relative;
		isolation: isolate;
		width: 100%;
		height: 100dvh;
		min-height: 24rem;
		overflow: hidden;
	}
	.canvas-editor {
		position: absolute;
		inset: 0;
	}
	.workspace-bar {
		position: absolute;
		z-index: 10;
		top: 1rem;
		left: 1rem;
		right: 1rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		pointer-events: none;
	}
	.workspace-navigation,
	.workspace-actions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		min-width: 0;
		padding: 0.375rem;
		background: #141a20;
		border: 1px solid #343e47;
		border-radius: 0.75rem;
		box-shadow: 0 4px 20px #0004;
		pointer-events: auto;
	}
	.workspace-navigation {
		flex-shrink: 1;
	}
	.workspace-actions {
		flex-shrink: 0;
	}
	.studio-menu {
		position: relative;
	}
	.studio-menu summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		list-style: none;
		min-height: var(--flow-control-height);
		padding: 0.4375rem 0.625rem;
		font-weight: 600;
		cursor: pointer;
		border-radius: var(--flow-radius);
	}
	.studio-menu summary::-webkit-details-marker {
		display: none;
	}
	nav {
		animation: menu-reveal 160ms ease-out;
		position: absolute;
		left: -0.375rem;
		top: calc(100% + 0.875rem);
		width: 12rem;
		padding: 0.375rem;
		border: 1px solid #39414b;
		background: #141a20;
		border-radius: 0.75rem;
		box-shadow: 0 8px 24px #0006;
	}
	nav a,
	nav button {
		display: flex;
		width: 100%;
		min-height: var(--flow-control-height);
		align-items: center;
		padding: 0.5rem 0.75rem;
		border: 0;
		border-radius: var(--flow-radius);
		background: none;
		color: #d2dce4;
		font: inherit;
		text-decoration: none;
		cursor: pointer;
	}
	nav a:hover,
	nav button:hover,
	.studio-menu summary:hover {
		background: #26313b;
	}
	.flow-title {
		gap: 0.5rem;
		max-width: 25rem;
	}
	.flow-title > span:first-child {
		max-width: 16rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.details-label {
		color: #a4adb7;
		font-size: var(--flow-help-font);
	}
	.disclosure {
		gap: 0.5rem;
	}
	.chevron {
		width: 0.4375rem;
		height: 0.4375rem;
		flex-shrink: 0;
		border-right: 1.5px solid currentColor;
		border-bottom: 1.5px solid currentColor;
		transform: translateY(-0.125rem) rotate(45deg);
		display: inline-block;
		transition: transform 180ms ease;
	}
	.disclosure[aria-expanded='true'] .chevron,
	.studio-menu[open] .chevron {
		transform: translateY(0.125rem) rotate(225deg);
	}
	.disclosure[aria-expanded='true'] {
		border-color: #557565;
		background: #21382c;
	}
	.panel {
		padding: 1rem;
		min-width: 0;
		border: 1px solid #343e47;
		border-radius: 0.875rem;
		background: #141a20;
		box-shadow: 0 8px 28px #0005;
	}
	.floating-panel {
		position: absolute;
		z-index: 5;
		top: 5.5rem;
		max-height: calc(100% - 11rem);
		overflow-y: auto;
		overscroll-behavior: contain;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		transform: translateX(-0.75rem);
		transition:
			opacity 180ms ease,
			transform 180ms ease,
			visibility 180ms;
	}
	.floating-panel.is-open {
		opacity: 1;
		visibility: visible;
		pointer-events: auto;
		transform: translateX(0);
	}
	.left-panel {
		left: 1rem;
		width: 20rem;
	}
	.right-panel {
		right: 1rem;
		width: 22rem;
		transform: translateX(0.75rem);
	}
	.panel-heading {
		display: flex;
		align-items: start;
		justify-content: space-between;
		gap: 0.75rem;
		margin-bottom: 1rem;
	}
	.panel-heading > strong {
		color: #a4adb7;
		font-size: var(--flow-help-font);
		font-weight: 500;
	}
	.runner .panel-heading {
		flex-wrap: wrap;
		margin-bottom: 0;
	}
	.runner .panel-heading > strong {
		flex-basis: 100%;
	}
	.eyebrow {
		margin: 0;
		color: #a4b3ad;
		font-size: var(--flow-help-font);
		font-weight: 500;
	}
	h2 {
		margin: 0.125rem 0 0;
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.muted,
	.form-actions span {
		color: #a4adb7;
		font-size: var(--flow-label-font);
	}
	.flow-list .form-actions {
		display: grid;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
	.flow-list .form-actions button {
		justify-content: start;
	}
	.stack {
		display: grid;
		gap: 0.375rem;
	}
	.stack button {
		display: flex;
		flex-direction: column;
		width: 100%;
		min-width: 0;
		gap: 0.25rem;
		padding: 0.625rem;
		border: 1px solid transparent;
		border-radius: var(--flow-radius);
		background: #0c1014;
		color: #edf0f3;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.stack button strong {
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}
	.stack button span {
		color: #a4adb7;
		font-size: var(--flow-help-font);
	}
	.stack button.chosen {
		border-color: #426d59;
		background: #15221c;
	}
	.editor form {
		display: grid;
		gap: 1rem;
	}
	label {
		display: grid;
		gap: 0.375rem;
		color: #c7ced5;
		font-size: var(--flow-label-font);
		font-weight: 500;
	}
	input,
	textarea {
		width: 100%;
		min-height: var(--flow-control-height);
		border: 1px solid #39414b;
		border-radius: var(--flow-radius);
		background: #0b0f13;
		color: #edf0f3;
		padding: 0.4375rem 0.625rem;
		font: inherit;
		font-size: var(--flow-control-font);
		font-weight: 400;
		line-height: 1.25rem;
	}
	textarea {
		resize: vertical;
	}
	input:focus,
	textarea:focus {
		outline: 2px solid #6ee7b7;
		outline-offset: 1px;
	}
	.flow-metadata {
		display: grid;
		gap: 1rem;
	}
	.form-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.form-actions .danger-link {
		order: 1;
	}
	.primary,
	.secondary,
	.danger-link,
	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: var(--flow-control-height);
		border: 1px solid transparent;
		border-radius: var(--flow-radius);
		padding: 0.4375rem 0.75rem;
		font: inherit;
		font-size: var(--flow-control-font);
		line-height: 1.25rem;
		font-weight: 500;
		white-space: nowrap;
		cursor: pointer;
	}
	.primary {
		background: #6ee7b7;
		color: #082a1d;
	}
	.primary.link {
		text-decoration: none;
	}
	.secondary {
		border-color: #39414b;
		background: #1b222a;
		color: #e4e9ed;
	}
	.danger-link {
		background: transparent;
		color: #ffabb6;
	}
	.icon-button {
		width: var(--flow-control-height);
		flex-shrink: 0;
		padding: 0;
		background: transparent;
		color: #b9c6cf;
		font-size: 1.25rem;
	}
	.primary:hover:not(:disabled) {
		background: #8aefc6;
	}
	.secondary:hover:not(:disabled),
	.stack button:hover:not(:disabled),
	.icon-button:hover:not(:disabled) {
		border-color: #6b7a84;
		background: #26313b;
	}
	.danger-link:hover:not(:disabled) {
		background: #2b171b;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	button:focus-visible,
	a:focus-visible,
	summary:focus-visible {
		outline: 2px solid #6ee7b7;
		outline-offset: 3px;
	}
	.graph-feedback {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		padding: 0.75rem;
		border: 1px solid #64562d;
		border-radius: var(--flow-radius);
		background: #29220f;
		color: #f8d477;
		font-size: var(--flow-label-font);
	}
	.graph-feedback span {
		color: #dfcc85;
	}
	.runner {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.run-toolbar {
		display: flex;
		gap: 0.625rem;
		align-items: center;
	}
	.save-state {
		font-size: var(--flow-help-font);
		color: #a4b3ad;
	}
	.panel-tabs {
		display: flex;
		border-bottom: 1px solid #303944;
	}
	.panel-tabs button {
		flex: 1;
		min-height: var(--flow-control-height);
		padding: 0.4375rem 0.25rem;
		border: 0;
		border-bottom: 2px solid transparent;
		background: transparent;
		color: #aeb6bf;
		cursor: pointer;
		font: inherit;
		font-size: var(--flow-label-font);
		font-weight: 500;
	}
	.panel-tabs button[aria-pressed='true'] {
		color: #91ecc3;
		border-bottom-color: #6ee7b7;
	}
	.panel-tabs button:hover {
		color: #edf0f3;
	}
	.panel-body {
		overflow-y: auto;
		min-height: 0;
		padding: 0.25rem;
		margin: -0.25rem;
	}
	.run-inputs {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
	}
	.readiness {
		border: 1px solid #38483e;
		background: #101c16;
		border-radius: var(--flow-radius);
		padding: 0.75rem;
		margin-bottom: 1rem;
		font-size: var(--flow-label-font);
	}
	.readiness p {
		margin: 0 0 0.5rem;
	}
	.readiness a,
	.readiness button {
		display: inline-flex;
		align-items: center;
		min-height: var(--flow-control-height);
		color: #a7e9ca;
		font: inherit;
		margin-right: 0.75rem;
	}
	.readiness button {
		background: transparent;
		border: 0;
		text-decoration: underline;
		cursor: pointer;
		padding: 0;
	}
	.node-config-dock :global(.config) {
		width: 100%;
		max-width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		box-shadow: none;
	}
	.runner .history {
		border: 0;
		padding: 0;
		box-shadow: none;
	}
	.history .stack {
		margin-top: 1rem;
	}
	.node-list {
		display: grid;
		gap: 0.5rem;
	}
	.node-list > div {
		display: grid;
		grid-template-columns: 1.5rem 1fr auto;
		align-items: center;
		gap: 0.625rem;
		padding: 0.625rem;
		border-radius: var(--flow-radius);
		background: #0b0f13;
		text-transform: capitalize;
	}
	.node-list strong {
		font-weight: 500;
	}
	.node-order {
		display: grid;
		width: 1.5rem;
		height: 1.5rem;
		place-items: center;
		border-radius: 0.375rem;
		background: #23302a;
		color: #6ee7b7;
		font-size: var(--flow-help-font);
	}
	em {
		font-style: normal;
		font-size: var(--flow-help-font);
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
		margin-top: 0.75rem;
		padding: 0.75rem;
		border: 1px solid #294b3e;
		border-radius: 0.5rem;
		background: #0b1712;
	}
	.result > .eyebrow {
		margin-bottom: 0.5rem;
	}
	pre {
		margin: 0.75rem 0 0;
		overflow: auto;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		font:
			0.8125rem/1.5 ui-monospace,
			SFMono-Regular,
			Consolas,
			monospace;
	}
	.canvas-notices {
		position: absolute;
		z-index: 12;
		bottom: 6rem;
		left: 50%;
		transform: translateX(-50%);
		width: min(30rem, calc(100% - 2rem));
		pointer-events: none;
	}
	.notice {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin: 0.5rem 0 0;
		padding: 0.5rem 0.75rem;
		border: 1px solid #303944;
		border-radius: var(--flow-radius);
		box-shadow: 0 4px 16px #0003;
		pointer-events: auto;
		font-size: var(--flow-label-font);
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
		margin: 3rem auto;
		max-width: 30rem;
		padding: 2rem;
		border: 1px solid #252d35;
		border-radius: 0.75rem;
		background: #11151a;
	}
	@media (max-width: 1100px) {
		.details-label,
		.workspace-actions .save-state {
			display: none;
		}
		.flow-title > span:first-child {
			max-width: 10rem;
		}
	}
	@media (max-width: 800px) {
		.workspace-bar {
			top: 0.5rem;
			left: 0.5rem;
			right: 0.5rem;
			flex-wrap: wrap;
			gap: 0.5rem;
		}
		.workspace-navigation {
			width: 100%;
		}
		.workspace-actions {
			margin-left: auto;
		}
		.flow-title {
			flex: 1;
			justify-content: space-between;
		}
		.flow-title > span:first-child {
			max-width: min(12rem, 40vw);
		}
		.floating-panel {
			top: 8rem;
			bottom: 6rem;
			max-height: none;
			left: 0.5rem;
			right: 0.5rem;
			width: auto;
			transform: translateY(0.75rem);
		}
		.floating-panel.is-open {
			transform: translateY(0);
		}
		.panel {
			padding: 0.875rem;
		}
		.canvas-notices {
			bottom: 6rem;
			z-index: 8;
		}
	}
	@media (pointer: coarse) {
		main {
			--flow-control-height: 2.75rem;
		}
		.floating-panel {
			top: 9rem;
		}
	}
	@keyframes menu-reveal {
		from {
			opacity: 0;
			transform: translateY(-0.375rem);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		nav {
			animation: none;
		}
		.floating-panel,
		.chevron {
			transition: none;
		}
	}
</style>
