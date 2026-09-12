import { isFlowImages, type FlowInputValue } from '$lib/flows/types';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { StudioDatabase } from '$lib/server/database/database';
import { decryptJson, encryptJson } from '$lib/server/sessions/crypto';
import { type FlowDefinitionV1, type FlowNodeV1, validateFlowDefinition } from './definition';
import { appendFlowAudit } from './audit';

const DEFAULT_CLAIM_TTL_MS = 30_000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
const MAX_INPUT_BYTES = 64 * 1024;
const MAX_CHECKPOINT_BYTES = 1024 * 1024;
const MAX_EVENTS = 256;

export type FlowExecutionState =
	'queued' | 'running' | 'cancel_requested' | 'succeeded' | 'failed' | 'cancelled';

export type FlowNodeState = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type FlowExecutionErrorCode =
	| 'validation_failed'
	| 'not_found'
	| 'conflict'
	| 'lost_claim'
	| 'authentication_required'
	| 'dependency_not_found'
	| 'rate_limited'
	| 'upstream_unavailable'
	| 'timeout'
	| 'cancelled'
	| 'model_result_unknown'
	| 'internal_error';

export class FlowExecutionError extends Error {
	constructor(
		readonly code: FlowExecutionErrorCode,
		readonly path?: string
	) {
		super(code);
		this.name = 'FlowExecutionError';
	}
}

export interface FlowExecutionCreateInput {
	idempotencyKey: unknown;
	flowVersion?: unknown;
	inputs: unknown;
}

export interface FlowExecutionSummary {
	id: string;
	flowId: string;
	flowVersion: number;
	state: FlowExecutionState;
	errorCode: string | null;
	createdAt: number;
	updatedAt: number;
	startedAt: number | null;
	finishedAt: number | null;
}

export interface FlowExecutionNodeRecord {
	nodeId: string;
	nodeType: FlowNodeV1['type'];
	nodeOrder: number;
	state: FlowNodeState;
	attempt: number;
	startedAt: number | null;
	finishedAt: number | null;
	errorCode: string | null;
	payload?: unknown;
}

export interface FlowExecutionRecord extends FlowExecutionSummary {
	inputs: Record<string, FlowInputValue>;
	output?: unknown;
	nodes: FlowExecutionNodeRecord[];
}

export interface FlowExecutionClaim extends FlowExecutionRecord {
	ownerOwuiUserId: string;
	definition: FlowDefinitionV1;
	claimToken: string;
	claimAttempt: number;
	claimExpiresAt: number;
}

export interface FlowExecutionEvent {
	executionId: string;
	sequence: number;
	eventType: 'execution' | 'node';
	nodeId: string | null;
	nodeType: FlowNodeV1['type'] | null;
	state: string | null;
	errorCode: string | null;
	createdAt: number;
}

export interface FlowExecutionStoreOptions {
	database: StudioDatabase;
	encryptionKey: Buffer;
	now?: () => number;
	nextId?: () => string;
	claimTtlMs?: number;
	maxConcurrent?: number;
}

interface FlowVersionRow {
	version: number;
	definition_json: string;
}

interface ExecutionRow {
	id: string;
	flow_id: string;
	flow_version: number;
	owner_owui_user_id: string;
	state: FlowExecutionState;
	encrypted_input: string;
	encrypted_output: string | null;
	error_code: string | null;
	created_at: number;
	updated_at: number;
	started_at: number | null;
	finished_at: number | null;
	claim_attempt: number;
	claim_expires_at: number | null;
}

interface NodeRow {
	node_id: string;
	node_type: FlowNodeV1['type'];
	node_order: number;
	state: FlowNodeState;
	attempt: number;
	started_at: number | null;
	finished_at: number | null;
	encrypted_payload: string | null;
	error_code: string | null;
}

interface EventRow {
	execution_id: string;
	sequence: number;
	event_type: 'execution' | 'node';
	node_id: string | null;
	node_type: FlowNodeV1['type'] | null;
	state: string | null;
	error_code: string | null;
	created_at: number;
}

export class FlowExecutionStore {
	private readonly now: () => number;
	private readonly nextId: () => string;
	private readonly claimTtlMs: number;
	private readonly maxConcurrent: number;

	constructor(private readonly options: FlowExecutionStoreOptions) {
		if (options.encryptionKey.length !== 32) throw new Error('encryptionKey must be 32 bytes');
		this.now = options.now ?? Date.now;
		this.nextId = options.nextId ?? randomUUID;
		this.claimTtlMs = positiveInteger(options.claimTtlMs ?? DEFAULT_CLAIM_TTL_MS, 'claimTtlMs');
		this.maxConcurrent = positiveInteger(options.maxConcurrent ?? 4, 'maxConcurrent');
	}

	create(
		ownerOwuiUserId: string,
		flowId: string,
		input: FlowExecutionCreateInput
	): FlowExecutionRecord {
		const owner = identifier(ownerOwuiUserId, '$.owner', 256);
		const safeFlowId = identifier(flowId, '$.flowId', 128);
		const idempotencyKey = identifier(
			input.idempotencyKey,
			'$.idempotencyKey',
			MAX_IDEMPOTENCY_KEY_LENGTH
		);
		const existing = this.findByIdempotencyKey(owner, idempotencyKey);
		if (existing) return this.record(existing);

		const now = this.now();
		const executionId = this.nextId();
		this.options.database
			.transaction(() => {
				const duplicate = this.findByIdempotencyKey(owner, idempotencyKey);
				if (duplicate) return;
				const version = this.resolveVersion(owner, safeFlowId, input.flowVersion);
				const definition = validateFlowDefinition(JSON.parse(version.definition_json));
				const inputs = runtimeInputs(input.inputs, definition);
				this.options.database
					.prepare(
						`INSERT INTO studio_flow_execution
					 (id, flow_id, flow_version, owner_owui_user_id, state, idempotency_key,
					  encrypted_input, created_at, updated_at)
					 VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?)`
					)
					.run(
						executionId,
						safeFlowId,
						version.version,
						owner,
						idempotencyKey,
						encryptJson(inputs, this.options.encryptionKey, inputAad(owner, executionId)),
						now,
						now
					);
				for (const [index, node] of topologicalNodes(definition).entries())
					this.options.database
						.prepare(
							`INSERT INTO studio_flow_execution_node
						 (execution_id, node_id, node_type, node_order, state, attempt)
						 VALUES (?, ?, ?, ?, 'pending', 0)`
						)
						.run(executionId, node.id, node.type, index + 1);
				this.appendEvent(executionId, owner, 'execution', null, null, 'queued', null, now);
				appendFlowAudit(this.options.database, {
					ownerOwuiUserId: owner,
					action: 'execution_queued',
					flowId: safeFlowId,
					flowVersion: version.version,
					executionId,
					executionState: 'queued',
					createdAt: now
				});
			})
			.immediate();
		const created = this.findByIdempotencyKey(owner, idempotencyKey);
		if (!created) throw new FlowExecutionError('internal_error');
		return this.record(created);
	}

	list(ownerOwuiUserId: string): FlowExecutionSummary[] {
		const owner = identifier(ownerOwuiUserId, '$.owner', 256);
		return (
			this.options.database
				.prepare(
					`SELECT * FROM studio_flow_execution
					 WHERE owner_owui_user_id = ?
					 ORDER BY created_at DESC, id ASC`
				)
				.all(owner) as ExecutionRow[]
		).map(summary);
	}

	get(ownerOwuiUserId: string, executionId: string): FlowExecutionRecord | null {
		const owner = identifier(ownerOwuiUserId, '$.owner', 256);
		const id = identifier(executionId, '$.executionId', 128);
		const row = this.find(owner, id);
		return row ? this.record(row) : null;
	}

	events(ownerOwuiUserId: string, executionId: string, afterSequence = 0): FlowExecutionEvent[] {
		const owner = identifier(ownerOwuiUserId, '$.owner', 256);
		const id = identifier(executionId, '$.executionId', 128);
		if (!Number.isSafeInteger(afterSequence) || afterSequence < 0)
			throw new FlowExecutionError('validation_failed', '$.afterSequence');
		if (!this.find(owner, id)) throw new FlowExecutionError('not_found');
		return (
			this.options.database
				.prepare(
					`SELECT execution_id, sequence, event_type, node_id, node_type,
					        state, error_code, created_at
					 FROM studio_flow_event
					 WHERE execution_id = ? AND owner_owui_user_id = ? AND sequence > ?
					 ORDER BY sequence ASC`
				)
				.all(id, owner, afterSequence) as EventRow[]
		).map(eventRecord);
	}

	claimNext(workerId: string): FlowExecutionClaim | null {
		const safeWorkerId = identifier(workerId, '$.workerId', 128);
		return this.options.database
			.transaction(() => {
				const active = this.options.database
					.prepare(
						"SELECT COUNT(*) AS count FROM studio_flow_execution WHERE state IN ('running', 'cancel_requested')"
					)
					.get() as { count: number };
				if (active.count >= this.maxConcurrent) return null;
				const candidate = this.options.database
					.prepare(
						`SELECT id, owner_owui_user_id, flow_id, flow_version
					 FROM studio_flow_execution AS candidate
					 WHERE state = 'queued'
					   AND NOT EXISTS (
					     SELECT 1 FROM studio_flow_execution AS active
					     WHERE active.owner_owui_user_id = candidate.owner_owui_user_id
					       AND active.state IN ('running', 'cancel_requested')
					   )
					 ORDER BY created_at ASC, id ASC
					 LIMIT 1`
					)
					.get() as
					| {
							id: string;
							owner_owui_user_id: string;
							flow_id: string;
							flow_version: number;
					  }
					| undefined;
				if (!candidate) return null;
				const now = this.now();
				const claimToken = randomBytes(32).toString('base64url');
				const claimExpiresAt = now + this.claimTtlMs;
				const changed = this.options.database
					.prepare(
						`UPDATE studio_flow_execution
						 SET state = 'running', claimed_by = ?, claim_token_hash = ?,
						     claim_attempt = claim_attempt + 1,
					     claim_expires_at = ?, heartbeat_at = ?, started_at = COALESCE(started_at, ?),
					     updated_at = ?
					 WHERE id = ? AND state = 'queued'`
					)
					.run(safeWorkerId, hashClaim(claimToken), claimExpiresAt, now, now, now, candidate.id);
				if (changed.changes !== 1) return null;
				this.appendEvent(
					candidate.id,
					candidate.owner_owui_user_id,
					'execution',
					null,
					null,
					'running',
					null,
					now
				);
				appendFlowAudit(this.options.database, {
					ownerOwuiUserId: candidate.owner_owui_user_id,
					action: 'execution_started',
					flowId: candidate.flow_id,
					flowVersion: candidate.flow_version,
					executionId: candidate.id,
					executionState: 'running',
					createdAt: now
				});
				return this.claimRecord(candidate.id, claimToken);
			})
			.immediate();
	}

	heartbeat(executionId: string, claimToken: string): { cancelRequested: boolean } {
		const id = identifier(executionId, '$.executionId', 128);
		const tokenHash = claimHash(claimToken);
		return this.options.database
			.transaction(() => {
				const now = this.now();
				const row = this.options.database
					.prepare(
						`SELECT state FROM studio_flow_execution
						 WHERE id = ? AND claim_token_hash = ?
						   AND state IN ('running', 'cancel_requested') AND claim_expires_at > ?`
					)
					.get(id, tokenHash, now) as { state: FlowExecutionState } | undefined;
				if (!row) throw new FlowExecutionError('lost_claim');
				this.options.database
					.prepare(
						`UPDATE studio_flow_execution
						 SET heartbeat_at = ?, claim_expires_at = ?, updated_at = ?
						 WHERE id = ? AND claim_token_hash = ?
						   AND state IN ('running', 'cancel_requested') AND claim_expires_at > ?`
					)
					.run(now, now + this.claimTtlMs, now, id, tokenHash, now);
				return { cancelRequested: row.state === 'cancel_requested' };
			})
			.immediate();
	}

	beginNode(executionId: string, claimToken: string, nodeId: string): FlowExecutionNodeRecord {
		const id = identifier(executionId, '$.executionId', 128);
		const safeNodeId = identifier(nodeId, '$.nodeId', 64);
		return this.options.database
			.transaction(() => {
				const execution = this.requireClaim(id, claimToken, 'running');
				const node = this.node(id, safeNodeId);
				if (!node) throw new FlowExecutionError('not_found');
				if (node.state === 'succeeded')
					return nodeRecord(node, execution.owner_owui_user_id, id, this.options.encryptionKey);
				if (node.state !== 'pending') throw new FlowExecutionError('conflict');
				const previous = this.options.database
					.prepare(
						`SELECT 1 FROM studio_flow_execution_node
					 WHERE execution_id = ? AND node_order < ? AND state != 'succeeded' LIMIT 1`
					)
					.get(id, node.node_order);
				if (previous) throw new FlowExecutionError('conflict');
				const now = this.now();
				this.options.database
					.prepare(
						`UPDATE studio_flow_execution_node
					 SET state = 'running', attempt = attempt + 1, started_at = ?,
					     finished_at = NULL, encrypted_payload = NULL, error_code = NULL
					 WHERE execution_id = ? AND node_id = ? AND state = 'pending'`
					)
					.run(now, id, safeNodeId);
				this.appendEvent(
					id,
					execution.owner_owui_user_id,
					'node',
					safeNodeId,
					node.node_type,
					'running',
					null,
					now
				);
				return nodeRecord(
					this.node(id, safeNodeId)!,
					execution.owner_owui_user_id,
					id,
					this.options.encryptionKey
				);
			})
			.immediate();
	}

	completeNode(
		executionId: string,
		claimToken: string,
		nodeId: string,
		payload: unknown
	): FlowExecutionNodeRecord {
		const id = identifier(executionId, '$.executionId', 128);
		const safeNodeId = identifier(nodeId, '$.nodeId', 64);
		const encoded = boundedJson(payload, '$.payload', MAX_CHECKPOINT_BYTES);
		return this.options.database
			.transaction(() => {
				const execution = this.requireClaim(id, claimToken, 'running');
				const node = this.node(id, safeNodeId);
				if (!node) throw new FlowExecutionError('not_found');
				if (node.state === 'succeeded')
					return nodeRecord(node, execution.owner_owui_user_id, id, this.options.encryptionKey);
				if (node.state !== 'running') throw new FlowExecutionError('conflict');
				const now = this.now();
				this.options.database
					.prepare(
						`UPDATE studio_flow_execution_node
					 SET state = 'succeeded', finished_at = ?, encrypted_payload = ?
					 WHERE execution_id = ? AND node_id = ? AND state = 'running'`
					)
					.run(
						now,
						encryptJson(
							JSON.parse(encoded),
							this.options.encryptionKey,
							checkpointAad(execution.owner_owui_user_id, id, safeNodeId, node.attempt)
						),
						id,
						safeNodeId
					);
				this.appendEvent(
					id,
					execution.owner_owui_user_id,
					'node',
					safeNodeId,
					node.node_type,
					'succeeded',
					null,
					now
				);
				return nodeRecord(
					this.node(id, safeNodeId)!,
					execution.owner_owui_user_id,
					id,
					this.options.encryptionKey
				);
			})
			.immediate();
	}

	finishSucceeded(executionId: string, claimToken: string, output: unknown): void {
		const id = identifier(executionId, '$.executionId', 128);
		const encoded = boundedJson(output, '$.output', MAX_CHECKPOINT_BYTES);
		this.options.database
			.transaction(() => {
				const execution = this.requireClaim(id, claimToken, 'running');
				const incomplete = this.options.database
					.prepare(
						`SELECT 1 FROM studio_flow_execution_node
					 WHERE execution_id = ? AND state != 'succeeded' LIMIT 1`
					)
					.get(id);
				if (incomplete) throw new FlowExecutionError('conflict');
				const now = this.now();
				this.options.database
					.prepare(
						`UPDATE studio_flow_execution
					 SET state = 'succeeded', encrypted_output = ?, error_code = NULL,
					     finished_at = ?, updated_at = ?
					 WHERE id = ? AND claim_token_hash = ? AND state = 'running'`
					)
					.run(
						encryptJson(
							JSON.parse(encoded),
							this.options.encryptionKey,
							outputAad(execution.owner_owui_user_id, id)
						),
						now,
						now,
						id,
						claimHash(claimToken)
					);
				this.appendEvent(
					id,
					execution.owner_owui_user_id,
					'execution',
					null,
					null,
					'succeeded',
					null,
					now
				);
				appendFlowAudit(this.options.database, {
					ownerOwuiUserId: execution.owner_owui_user_id,
					action: 'execution_succeeded',
					flowId: execution.flow_id,
					flowVersion: execution.flow_version,
					executionId: id,
					executionState: 'succeeded',
					createdAt: now
				});
			})
			.immediate();
	}

	finishFailed(
		executionId: string,
		claimToken: string,
		errorCode: Exclude<FlowExecutionErrorCode, 'not_found' | 'conflict' | 'lost_claim'>
	): void {
		const id = identifier(executionId, '$.executionId', 128);
		const safeError = stableExecutionError(errorCode);
		this.options.database
			.transaction(() => {
				const execution = this.requireClaim(id, claimToken, 'running');
				const now = this.now();
				this.settleOpenNodes(execution, 'failed', safeError, now);
				this.options.database
					.prepare(
						`UPDATE studio_flow_execution SET state = 'failed', error_code = ?,
					 finished_at = ?, updated_at = ?
					 WHERE id = ? AND claim_token_hash = ? AND state = 'running'`
					)
					.run(safeError, now, now, id, claimHash(claimToken));
				this.appendEvent(
					id,
					execution.owner_owui_user_id,
					'execution',
					null,
					null,
					'failed',
					safeError,
					now
				);
				appendFlowAudit(this.options.database, {
					ownerOwuiUserId: execution.owner_owui_user_id,
					action: 'execution_failed',
					flowId: execution.flow_id,
					flowVersion: execution.flow_version,
					executionId: id,
					executionState: 'failed',
					errorCode: safeError,
					createdAt: now
				});
			})
			.immediate();
	}

	requestCancel(ownerOwuiUserId: string, executionId: string): FlowExecutionRecord {
		const owner = identifier(ownerOwuiUserId, '$.owner', 256);
		const id = identifier(executionId, '$.executionId', 128);
		this.options.database
			.transaction(() => {
				const execution = this.find(owner, id);
				if (!execution) throw new FlowExecutionError('not_found');
				if (terminal(execution.state) || execution.state === 'cancel_requested') return;
				const now = this.now();
				const nextState = execution.state === 'queued' ? 'cancelled' : 'cancel_requested';
				this.options.database
					.prepare(
						`UPDATE studio_flow_execution
					 SET state = ?, error_code = ?, updated_at = ?,
					     finished_at = CASE WHEN ? = 'cancelled' THEN ? ELSE finished_at END
					 WHERE id = ? AND owner_owui_user_id = ? AND state = ?`
					)
					.run(nextState, 'cancelled', now, nextState, now, id, owner, execution.state);
				if (nextState === 'cancelled')
					this.settleOpenNodes(execution, 'cancelled', 'cancelled', now);
				this.appendEvent(id, owner, 'execution', null, null, nextState, 'cancelled', now);
				appendFlowAudit(this.options.database, {
					ownerOwuiUserId: owner,
					action: nextState === 'cancelled' ? 'execution_cancelled' : 'execution_cancel_requested',
					flowId: execution.flow_id,
					flowVersion: execution.flow_version,
					executionId: id,
					executionState: nextState,
					errorCode: 'cancelled',
					createdAt: now
				});
			})
			.immediate();
		return this.record(this.find(owner, id)!);
	}

	acknowledgeCancelled(executionId: string, claimToken: string): void {
		const id = identifier(executionId, '$.executionId', 128);
		this.options.database
			.transaction(() => {
				const execution = this.requireClaim(id, claimToken, 'cancel_requested');
				const now = this.now();
				this.settleOpenNodes(execution, 'cancelled', 'cancelled', now);
				this.options.database
					.prepare(
						`UPDATE studio_flow_execution SET state = 'cancelled', error_code = 'cancelled',
					 finished_at = ?, updated_at = ?
					 WHERE id = ? AND claim_token_hash = ? AND state = 'cancel_requested'`
					)
					.run(now, now, id, claimHash(claimToken));
				this.appendEvent(
					id,
					execution.owner_owui_user_id,
					'execution',
					null,
					null,
					'cancelled',
					'cancelled',
					now
				);
				appendFlowAudit(this.options.database, {
					ownerOwuiUserId: execution.owner_owui_user_id,
					action: 'execution_cancelled',
					flowId: execution.flow_id,
					flowVersion: execution.flow_version,
					executionId: id,
					executionState: 'cancelled',
					errorCode: 'cancelled',
					createdAt: now
				});
			})
			.immediate();
	}

	recoverStale(): { requeued: number; failed: number; cancelled: number } {
		const result = { requeued: 0, failed: 0, cancelled: 0 };
		this.options.database
			.transaction(() => {
				const now = this.now();
				const stale = this.options.database
					.prepare(
						`SELECT * FROM studio_flow_execution
					 WHERE state IN ('running', 'cancel_requested') AND claim_expires_at <= ?
					 ORDER BY claim_expires_at ASC, id ASC`
					)
					.all(now) as ExecutionRow[];
				for (const execution of stale) {
					if (execution.state === 'cancel_requested') {
						this.recoverTerminal(execution, 'cancelled', 'cancelled', now);
						result.cancelled++;
						continue;
					}
					const uncertainModel = this.options.database
						.prepare(
							`SELECT 1 FROM studio_flow_execution_node
						 WHERE execution_id = ? AND node_type = 'model' AND state = 'running' LIMIT 1`
						)
						.get(execution.id);
					if (uncertainModel) {
						this.recoverTerminal(execution, 'failed', 'model_result_unknown', now);
						result.failed++;
						continue;
					}
					this.options.database
						.prepare(
							`UPDATE studio_flow_execution_node
						 SET state = 'pending', started_at = NULL, finished_at = NULL,
						     encrypted_payload = NULL, error_code = NULL
						 WHERE execution_id = ? AND state = 'running'`
						)
						.run(execution.id);
					this.options.database
						.prepare(
							`UPDATE studio_flow_execution
						 SET state = 'queued', claim_token_hash = NULL, claim_expires_at = NULL,
						     heartbeat_at = NULL, updated_at = ? WHERE id = ? AND state = 'running'`
						)
						.run(now, execution.id);
					this.appendEvent(
						execution.id,
						execution.owner_owui_user_id,
						'execution',
						null,
						null,
						'queued',
						null,
						now
					);
					appendFlowAudit(this.options.database, {
						ownerOwuiUserId: execution.owner_owui_user_id,
						action: 'execution_requeued',
						flowId: execution.flow_id,
						flowVersion: execution.flow_version,
						executionId: execution.id,
						executionState: 'queued',
						createdAt: now
					});
					result.requeued++;
				}
			})
			.immediate();
		return result;
	}

	private recoverTerminal(
		execution: ExecutionRow,
		state: 'failed' | 'cancelled',
		errorCode: 'model_result_unknown' | 'cancelled',
		now: number
	) {
		this.settleOpenNodes(execution, state, errorCode, now);
		this.options.database
			.prepare(
				`UPDATE studio_flow_execution SET state = ?, error_code = ?, finished_at = ?, updated_at = ?
				 WHERE id = ? AND state = ?`
			)
			.run(state, errorCode, now, now, execution.id, execution.state);
		this.appendEvent(
			execution.id,
			execution.owner_owui_user_id,
			'execution',
			null,
			null,
			state,
			errorCode,
			now
		);
		appendFlowAudit(this.options.database, {
			ownerOwuiUserId: execution.owner_owui_user_id,
			action: state === 'cancelled' ? 'execution_cancelled' : 'execution_failed',
			flowId: execution.flow_id,
			flowVersion: execution.flow_version,
			executionId: execution.id,
			executionState: state,
			errorCode,
			createdAt: now
		});
	}

	private settleOpenNodes(
		execution: ExecutionRow,
		executionState: 'failed' | 'cancelled',
		errorCode: string,
		now: number
	) {
		const nodes = this.options.database
			.prepare(
				`SELECT node_id, node_type, node_order, state, attempt, started_at,
				        finished_at, encrypted_payload, error_code
				 FROM studio_flow_execution_node
				 WHERE execution_id = ? AND state IN ('pending', 'running')
				 ORDER BY node_order ASC`
			)
			.all(execution.id) as NodeRow[];
		for (const node of nodes) {
			const nodeState =
				executionState === 'failed' && node.state === 'running' ? 'failed' : 'cancelled';
			const nodeError =
				nodeState === 'failed' ? errorCode : executionState === 'cancelled' ? 'cancelled' : null;
			this.options.database
				.prepare(
					`UPDATE studio_flow_execution_node
					 SET state = ?, finished_at = ?, error_code = ?
					 WHERE execution_id = ? AND node_id = ? AND state = ?`
				)
				.run(nodeState, now, nodeError, execution.id, node.node_id, node.state);
			this.appendEvent(
				execution.id,
				execution.owner_owui_user_id,
				'node',
				node.node_id,
				node.node_type,
				nodeState,
				nodeError,
				now
			);
		}
	}

	private resolveVersion(owner: string, flowId: string, requested: unknown): FlowVersionRow {
		let version: number | undefined;
		if (requested !== undefined) {
			if (!Number.isSafeInteger(requested) || (requested as number) < 1)
				throw new FlowExecutionError('validation_failed', '$.flowVersion');
			version = requested as number;
		}
		const row = this.options.database
			.prepare(
				`SELECT v.version, v.definition_json
				 FROM studio_flow_version v
				 JOIN studio_flow f ON f.id = v.flow_id AND f.owner_owui_user_id = v.owner_owui_user_id
				 WHERE v.flow_id = ? AND v.owner_owui_user_id = ?
				   AND v.version = COALESCE(?, f.current_version)`
			)
			.get(flowId, owner, version ?? null) as FlowVersionRow | undefined;
		if (!row) throw new FlowExecutionError('not_found');
		return row;
	}

	private find(owner: string, id: string): ExecutionRow | undefined {
		return this.options.database
			.prepare('SELECT * FROM studio_flow_execution WHERE id = ? AND owner_owui_user_id = ?')
			.get(id, owner) as ExecutionRow | undefined;
	}

	private findByIdempotencyKey(owner: string, key: string): ExecutionRow | undefined {
		return this.options.database
			.prepare(
				'SELECT * FROM studio_flow_execution WHERE owner_owui_user_id = ? AND idempotency_key = ?'
			)
			.get(owner, key) as ExecutionRow | undefined;
	}

	private node(executionId: string, nodeId: string): NodeRow | undefined {
		return this.options.database
			.prepare(
				`SELECT node_id, node_type, node_order, state, attempt, started_at,
				        finished_at, encrypted_payload, error_code
				 FROM studio_flow_execution_node WHERE execution_id = ? AND node_id = ?`
			)
			.get(executionId, nodeId) as NodeRow | undefined;
	}

	private record(row: ExecutionRow): FlowExecutionRecord {
		const nodes = this.options.database
			.prepare(
				`SELECT node_id, node_type, node_order, state, attempt, started_at,
				        finished_at, encrypted_payload, error_code
				 FROM studio_flow_execution_node WHERE execution_id = ? ORDER BY node_order ASC`
			)
			.all(row.id) as NodeRow[];
		return {
			...summary(row),
			inputs: decryptJson<Record<string, FlowInputValue>>(
				row.encrypted_input,
				this.options.encryptionKey,
				inputAad(row.owner_owui_user_id, row.id)
			),
			...(row.encrypted_output
				? {
						output: decryptJson(
							row.encrypted_output,
							this.options.encryptionKey,
							outputAad(row.owner_owui_user_id, row.id)
						)
					}
				: {}),
			nodes: nodes.map((node) =>
				nodeRecord(node, row.owner_owui_user_id, row.id, this.options.encryptionKey)
			)
		};
	}

	private claimRecord(executionId: string, claimToken: string): FlowExecutionClaim {
		const row = this.options.database
			.prepare('SELECT * FROM studio_flow_execution WHERE id = ?')
			.get(executionId) as ExecutionRow;
		const version = this.options.database
			.prepare(
				`SELECT definition_json FROM studio_flow_version
				 WHERE flow_id = ? AND version = ? AND owner_owui_user_id = ?`
			)
			.get(row.flow_id, row.flow_version, row.owner_owui_user_id) as { definition_json: string };
		return {
			...this.record(row),
			ownerOwuiUserId: row.owner_owui_user_id,
			definition: validateFlowDefinition(JSON.parse(version.definition_json)),
			claimToken,
			claimAttempt: row.claim_attempt,
			claimExpiresAt: row.claim_expires_at!
		};
	}

	private requireClaim(
		executionId: string,
		claimToken: string,
		state: 'running' | 'cancel_requested'
	): ExecutionRow {
		const row = this.options.database
			.prepare(
				`SELECT * FROM studio_flow_execution
				 WHERE id = ? AND claim_token_hash = ? AND state = ? AND claim_expires_at > ?`
			)
			.get(executionId, claimHash(claimToken), state, this.now()) as ExecutionRow | undefined;
		if (!row) throw new FlowExecutionError('lost_claim');
		return row;
	}

	private appendEvent(
		executionId: string,
		owner: string,
		eventType: 'execution' | 'node',
		nodeId: string | null,
		nodeType: FlowNodeV1['type'] | null,
		state: string,
		errorCode: string | null,
		createdAt: number
	) {
		const sequence = (
			this.options.database
				.prepare(
					'SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM studio_flow_event WHERE execution_id = ?'
				)
				.get(executionId) as { sequence: number }
		).sequence;
		this.options.database
			.prepare(
				`INSERT INTO studio_flow_event
				 (execution_id, sequence, owner_owui_user_id, event_type, node_id,
				  node_type, state, error_code, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(executionId, sequence, owner, eventType, nodeId, nodeType, state, errorCode, createdAt);
		this.options.database
			.prepare('DELETE FROM studio_flow_event WHERE execution_id = ? AND sequence <= ?')
			.run(executionId, sequence - MAX_EVENTS);
	}
}

function runtimeInputs(
	value: unknown,
	definition: FlowDefinitionV1
): Record<string, FlowInputValue> {
	if (!isRecord(value)) throw new FlowExecutionError('validation_failed', '$.inputs');
	const inputNodes = definition.nodes.filter((node) => node.type === 'input');
	const allowed = new Map(inputNodes.map((node) => [node.config.key, node]));
	for (const key of Object.keys(value))
		if (!allowed.has(key)) throw new FlowExecutionError('validation_failed', `$.inputs.${key}`);
	const result: Record<string, FlowInputValue> = {};
	for (const node of inputNodes) {
		const supplied = value[node.config.key];
		const resolved = supplied ?? node.config.defaultValue;
		if (node.config.kind === 'images') {
			if (!isFlowImages(resolved))
				throw new FlowExecutionError('validation_failed', `$.inputs.${node.config.key}`);
			result[node.config.key] = { kind: 'images', fileIds: [...resolved.fileIds] };
			continue;
		}
		if (typeof resolved !== 'string')
			throw new FlowExecutionError('validation_failed', `$.inputs.${node.config.key}`);
		if (Buffer.byteLength(resolved, 'utf8') > 16 * 1024)
			throw new FlowExecutionError('validation_failed', `$.inputs.${node.config.key}`);
		result[node.config.key] = resolved;
	}
	boundedJson(result, '$.inputs', MAX_INPUT_BYTES);
	return result;
}

function topologicalNodes(definition: FlowDefinitionV1): FlowNodeV1[] {
	const nodeById = new Map(definition.nodes.map((node) => [node.id, node]));
	const indegree = new Map(definition.nodes.map((node) => [node.id, 0]));
	const adjacency = new Map(definition.nodes.map((node) => [node.id, [] as string[]]));
	for (const edge of definition.edges) {
		indegree.set(edge.target, indegree.get(edge.target)! + 1);
		adjacency.get(edge.source)!.push(edge.target);
	}
	const ready = definition.nodes
		.filter((node) => indegree.get(node.id) === 0)
		.map((node) => node.id)
		.sort();
	const result: FlowNodeV1[] = [];
	while (ready.length > 0) {
		const id = ready.shift()!;
		result.push(nodeById.get(id)!);
		for (const target of adjacency.get(id)!.sort()) {
			indegree.set(target, indegree.get(target)! - 1);
			if (indegree.get(target) === 0) {
				ready.push(target);
				ready.sort();
			}
		}
	}
	return result;
}

function summary(row: ExecutionRow): FlowExecutionSummary {
	return {
		id: row.id,
		flowId: row.flow_id,
		flowVersion: row.flow_version,
		state: row.state,
		errorCode: row.error_code,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at
	};
}

function nodeRecord(
	row: NodeRow,
	owner: string,
	executionId: string,
	key: Buffer
): FlowExecutionNodeRecord {
	return {
		nodeId: row.node_id,
		nodeType: row.node_type,
		nodeOrder: row.node_order,
		state: row.state,
		attempt: row.attempt,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		errorCode: row.error_code,
		...(row.encrypted_payload
			? {
					payload: decryptJson(
						row.encrypted_payload,
						key,
						checkpointAad(owner, executionId, row.node_id, row.attempt)
					)
				}
			: {})
	};
}

function eventRecord(row: EventRow): FlowExecutionEvent {
	return {
		executionId: row.execution_id,
		sequence: row.sequence,
		eventType: row.event_type,
		nodeId: row.node_id,
		nodeType: row.node_type,
		state: row.state,
		errorCode: row.error_code,
		createdAt: row.created_at
	};
}

function identifier(value: unknown, path: string, maxLength: number): string {
	if (typeof value !== 'string' || !value || value.length > maxLength)
		throw new FlowExecutionError('validation_failed', path);
	return value;
}

function positiveInteger(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 1)
		throw new Error(`${name} must be a positive integer`);
	return value;
}

function boundedJson(value: unknown, path: string, maxBytes: number): string {
	let encoded: string | undefined;
	try {
		encoded = JSON.stringify(value);
	} catch {
		throw new FlowExecutionError('validation_failed', path);
	}
	if (encoded === undefined || Buffer.byteLength(encoded, 'utf8') > maxBytes)
		throw new FlowExecutionError('validation_failed', path);
	return encoded;
}

function claimHash(token: string): string {
	if (!token || token.length > 128) throw new FlowExecutionError('lost_claim');
	return hashClaim(token);
}

function hashClaim(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

function stableExecutionError(value: string): string {
	const allowed = new Set([
		'validation_failed',
		'authentication_required',
		'dependency_not_found',
		'rate_limited',
		'upstream_unavailable',
		'timeout',
		'cancelled',
		'model_result_unknown',
		'internal_error'
	]);
	if (!allowed.has(value)) throw new FlowExecutionError('validation_failed', '$.errorCode');
	return value;
}

function terminal(state: FlowExecutionState): boolean {
	return state === 'succeeded' || state === 'failed' || state === 'cancelled';
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inputAad(owner: string, executionId: string): string {
	return `studio-flow-execution-input:v1:${owner}:${executionId}`;
}

function outputAad(owner: string, executionId: string): string {
	return `studio-flow-execution-output:v1:${owner}:${executionId}`;
}

function checkpointAad(
	owner: string,
	executionId: string,
	nodeId: string,
	attempt: number
): string {
	return `studio-flow-checkpoint:v1:${owner}:${executionId}:${nodeId}:${attempt}`;
}
