import type { FlowCredentialLeaseStore } from './credential-leases';
import {
	FlowExecutionError,
	type FlowExecutionClaim,
	type FlowExecutionErrorCode,
	type FlowExecutionStore
} from './executions';
import type { FlowDefinitionV1, FlowNodeV1, FlowTransformConfigV1 } from './definition';
import { OwuiError } from '$lib/server/owui/errors';
import type { OwuiTextCompletion, OwuiTextCompletionRequest } from '$lib/server/owui/contracts';

const DEFAULT_HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_RUN_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_NODE_TIMEOUT_MS = 2 * 60 * 1000;

export interface FlowCompletionClient {
	completeText(input: OwuiTextCompletionRequest): Promise<OwuiTextCompletion>;
}

export interface FlowWorkerOptions {
	workerId: string;
	executions: FlowExecutionStore;
	credentialLeases: FlowCredentialLeaseStore;
	clientForToken: (token: string) => FlowCompletionClient;
	heartbeatIntervalMs?: number;
	runTimeoutMs?: number;
	nodeTimeoutMs?: number;
}

export type FlowWorkerRunResult =
	| { status: 'idle' }
	| { status: 'succeeded'; executionId: string }
	| { status: 'failed'; executionId: string; errorCode: string }
	| { status: 'cancelled'; executionId: string }
	| { status: 'lost_claim'; executionId: string };

type WorkerFailureCode = Exclude<
	FlowExecutionErrorCode,
	'not_found' | 'conflict' | 'lost_claim' | 'cancelled'
>;

class WorkerFailure extends Error {
	constructor(readonly code: WorkerFailureCode) {
		super(code);
		this.name = 'WorkerFailure';
	}
}

class WorkerAbort extends Error {
	constructor(readonly reasonCode: 'cancelled' | 'timeout' | 'lost_claim') {
		super(reasonCode);
		this.name = 'WorkerAbort';
	}
}

export class FlowWorker {
	private readonly heartbeatIntervalMs: number;
	private readonly runTimeoutMs: number;
	private readonly nodeTimeoutMs: number;

	constructor(private readonly options: FlowWorkerOptions) {
		if (!options.workerId || options.workerId.length > 128) throw new Error('workerId is required');
		this.heartbeatIntervalMs = positiveInteger(
			options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
			'heartbeatIntervalMs'
		);
		this.runTimeoutMs = positiveInteger(
			options.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
			'runTimeoutMs'
		);
		this.nodeTimeoutMs = positiveInteger(
			options.nodeTimeoutMs ?? DEFAULT_NODE_TIMEOUT_MS,
			'nodeTimeoutMs'
		);
	}

	async runOnce(): Promise<FlowWorkerRunResult> {
		this.options.executions.recoverStale();
		const claim = this.options.executions.claimNext(this.options.workerId);
		if (!claim) return { status: 'idle' };

		const runController = new AbortController();
		let cancellationSeen = false;
		let claimLost = false;
		const pulse = () => {
			try {
				const heartbeat = this.options.executions.heartbeat(claim.id, claim.claimToken);
				if (heartbeat.cancelRequested) {
					cancellationSeen = true;
					if (!runController.signal.aborted) runController.abort(new WorkerAbort('cancelled'));
				}
			} catch (error) {
				if (error instanceof FlowExecutionError && error.code === 'lost_claim') {
					claimLost = true;
					if (!runController.signal.aborted) runController.abort(new WorkerAbort('lost_claim'));
					return;
				}
				throw error;
			}
		};
		const heartbeatTimer = setInterval(() => {
			try {
				pulse();
			} catch (error) {
				if (!runController.signal.aborted) runController.abort(error);
			}
		}, this.heartbeatIntervalMs);
		const runTimer = setTimeout(
			() => runController.abort(new WorkerAbort('timeout')),
			this.runTimeoutMs
		);

		try {
			pulse();
			throwIfAborted(runController.signal);
			const output = await this.executeClaim(claim, runController.signal, pulse);
			pulse();
			throwIfAborted(runController.signal);
			this.options.executions.finishSucceeded(claim.id, claim.claimToken, output);
			return { status: 'succeeded', executionId: claim.id };
		} catch (error) {
			if (!claimLost && !cancellationSeen) {
				try {
					const heartbeat = this.options.executions.heartbeat(claim.id, claim.claimToken);
					if (heartbeat.cancelRequested) cancellationSeen = true;
				} catch (heartbeatError) {
					if (heartbeatError instanceof FlowExecutionError && heartbeatError.code === 'lost_claim')
						claimLost = true;
					else throw heartbeatError;
				}
			}
			if (claimLost) return { status: 'lost_claim', executionId: claim.id };
			if (cancellationSeen || abortReason(error) === 'cancelled') {
				try {
					this.options.executions.acknowledgeCancelled(claim.id, claim.claimToken);
					return { status: 'cancelled', executionId: claim.id };
				} catch (cancelError) {
					if (cancelError instanceof FlowExecutionError && cancelError.code === 'lost_claim')
						return { status: 'lost_claim', executionId: claim.id };
					throw cancelError;
				}
			}
			const errorCode = workerErrorCode(error);
			try {
				this.options.executions.finishFailed(claim.id, claim.claimToken, errorCode);
				return { status: 'failed', executionId: claim.id, errorCode };
			} catch (finishError) {
				if (finishError instanceof FlowExecutionError && finishError.code === 'lost_claim')
					return { status: 'lost_claim', executionId: claim.id };
				throw finishError;
			}
		} finally {
			clearInterval(heartbeatTimer);
			clearTimeout(runTimer);
		}
	}

	private async executeClaim(
		claim: FlowExecutionClaim,
		runSignal: AbortSignal,
		pulse: () => void
	): Promise<unknown> {
		const definitionById = new Map(claim.definition.nodes.map((node) => [node.id, node]));
		const outputs = new Map<string, unknown>();
		for (const checkpoint of claim.nodes)
			if (checkpoint.state === 'succeeded') outputs.set(checkpoint.nodeId, checkpoint.payload);

		for (const checkpoint of claim.nodes) {
			if (checkpoint.state === 'succeeded') continue;
			pulse();
			throwIfAborted(runSignal);
			const node = definitionById.get(checkpoint.nodeId);
			if (!node || node.type !== checkpoint.nodeType) throw new WorkerFailure('internal_error');
			this.options.executions.beginNode(claim.id, claim.claimToken, node.id);
			const nodeController = new AbortController();
			const nodeTimer = setTimeout(
				() => nodeController.abort(new WorkerAbort('timeout')),
				this.nodeTimeoutMs
			);
			try {
				const signal = AbortSignal.any([runSignal, nodeController.signal]);
				const output = await this.evaluateNode(claim, node, outputs, signal);
				throwIfAborted(signal);
				this.options.executions.completeNode(claim.id, claim.claimToken, node.id, output);
				outputs.set(node.id, output);
			} finally {
				clearTimeout(nodeTimer);
			}
			pulse();
			throwIfAborted(runSignal);
		}

		const outputNode = claim.definition.nodes.find((node) => node.type === 'output');
		if (!outputNode || !outputs.has(outputNode.id)) throw new WorkerFailure('internal_error');
		return outputs.get(outputNode.id);
	}

	private async evaluateNode(
		claim: FlowExecutionClaim,
		node: FlowNodeV1,
		outputs: Map<string, unknown>,
		signal: AbortSignal
	): Promise<unknown> {
		throwIfAborted(signal);
		if (node.type === 'input') return claim.inputs[node.config.key];
		if (node.type === 'model') {
			const credential = this.options.credentialLeases.acquire(claim.ownerOwuiUserId, claim.id);
			if (!credential) throw new WorkerFailure('authentication_required');
			const prompt = renderTemplate(node.config.prompt, outputs);
			const completion = await abortable(
				this.options.clientForToken(credential.owuiToken).completeText({
					modelId: node.config.modelId,
					prompt,
					...(node.config.temperature === undefined
						? {}
						: { temperature: node.config.temperature }),
					...(node.config.maxTokens === undefined ? {} : { maxTokens: node.config.maxTokens }),
					signal
				}),
				signal
			);
			return completion.content;
		}
		const incoming = incomingValues(claim.definition, node.id, outputs);
		if (node.type === 'transform') return transform(node.config, incoming, outputs);
		return formatOutput(node.config.format, oneInput(incoming));
	}
}

function incomingValues(
	definition: FlowDefinitionV1,
	nodeId: string,
	outputs: Map<string, unknown>
): unknown[] {
	return definition.edges
		.filter((edge) => edge.target === nodeId)
		.map((edge) => {
			if (!outputs.has(edge.source)) throw new WorkerFailure('internal_error');
			return outputs.get(edge.source);
		});
}

function transform(
	config: FlowTransformConfigV1,
	incoming: unknown[],
	outputs: Map<string, unknown>
): unknown {
	if (config.operation === 'template') return renderTemplate(config.template, outputs);
	const value = oneInput(incoming);
	if (config.operation === 'extract') return extract(value, config.path);
	if (typeof value !== 'string') throw new WorkerFailure('validation_failed');
	if (config.operation === 'uppercase') return value.toUpperCase();
	if (config.operation === 'lowercase') return value.toLowerCase();
	if (config.operation === 'trim') return value.trim();
	if (config.operation === 'replace') return value.replaceAll(config.search, config.replacement);
	throw new WorkerFailure('internal_error');
}

function extract(value: unknown, path: string): unknown {
	let current: unknown = value;
	if (typeof current === 'string') {
		try {
			current = JSON.parse(current);
		} catch {
			throw new WorkerFailure('validation_failed');
		}
	}
	for (const segment of path.split('.')) {
		if (!isRecord(current) || !(segment in current)) throw new WorkerFailure('validation_failed');
		current = current[segment];
	}
	return current;
}

function formatOutput(format: 'text' | 'json', value: unknown): unknown {
	if (format === 'text') return typeof value === 'string' ? value : JSON.stringify(value);
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		throw new WorkerFailure('validation_failed');
	}
}

function oneInput(values: unknown[]): unknown {
	if (values.length !== 1) throw new WorkerFailure('validation_failed');
	return values[0];
}

function renderTemplate(template: string, outputs: Map<string, unknown>): string {
	return template.replace(
		/{{\s*node\.([A-Za-z][A-Za-z0-9_-]{0,63})\.output\s*}}/g,
		(_, nodeId: string) => {
			if (!outputs.has(nodeId)) throw new WorkerFailure('internal_error');
			const value = outputs.get(nodeId);
			return typeof value === 'string' ? value : JSON.stringify(value);
		}
	);
}

function workerErrorCode(error: unknown): WorkerFailureCode {
	if (abortReason(error) === 'timeout') return 'timeout';
	if (error instanceof WorkerFailure) return error.code;
	if (error instanceof OwuiError) {
		if (error.code === 'authentication_required') return 'authentication_required';
		if (error.code === 'permission_denied' || error.code === 'not_found')
			return 'dependency_not_found';
		if (error.code === 'rate_limited') return 'rate_limited';
		if (error.code === 'timeout') return 'timeout';
		return 'upstream_unavailable';
	}
	return 'internal_error';
}

function abortReason(error: unknown): WorkerAbort['reasonCode'] | null {
	return error instanceof WorkerAbort ? error.reasonCode : null;
}

function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new WorkerFailure('internal_error');
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		promise.then(
			(value) => {
				signal.removeEventListener('abort', abort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener('abort', abort);
				reject(error);
			}
		);
	});
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1)
		throw new Error(`${name} must be a positive integer`);
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
