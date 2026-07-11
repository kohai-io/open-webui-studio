import type { StudioDatabase } from '$lib/server/database/database';
import type { FlowExecutionState } from './executions';

export type FlowAuditAction =
	| 'flow_created'
	| 'flow_updated'
	| 'flow_deleted'
	| 'execution_queued'
	| 'execution_started'
	| 'execution_requeued'
	| 'execution_cancel_requested'
	| 'execution_cancelled'
	| 'execution_succeeded'
	| 'execution_failed';

export interface FlowAuditEntry {
	ownerOwuiUserId: string;
	action: FlowAuditAction;
	flowId: string;
	flowVersion?: number;
	executionId?: string;
	executionState?: FlowExecutionState;
	errorCode?: string;
	createdAt: number;
}

export interface FlowAuditRecord {
	id: number;
	ownerOwuiUserId: string;
	action: FlowAuditAction;
	flowId: string;
	flowVersion: number | null;
	executionId: string | null;
	executionState: FlowExecutionState | null;
	errorCode: string | null;
	createdAt: number;
}

interface FlowAuditRow {
	id: number;
	owner_owui_user_id: string;
	action: FlowAuditAction;
	flow_id: string;
	flow_version: number | null;
	execution_id: string | null;
	execution_state: FlowExecutionState | null;
	error_code: string | null;
	created_at: number;
}

export function appendFlowAudit(database: StudioDatabase, entry: FlowAuditEntry): void {
	database
		.prepare(
			`INSERT INTO studio_flow_audit
			 (owner_owui_user_id, action, flow_id, flow_version, execution_id,
			  execution_state, error_code, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(
			entry.ownerOwuiUserId,
			entry.action,
			entry.flowId,
			entry.flowVersion ?? null,
			entry.executionId ?? null,
			entry.executionState ?? null,
			entry.errorCode ?? null,
			entry.createdAt
		);
}

export class FlowAuditStore {
	constructor(private readonly database: StudioDatabase) {}

	list(ownerOwuiUserId: string): FlowAuditRecord[] {
		if (!ownerOwuiUserId || ownerOwuiUserId.length > 256) return [];
		return (
			this.database
				.prepare(
					`SELECT id, owner_owui_user_id, action, flow_id, flow_version,
					        execution_id, execution_state, error_code, created_at
					 FROM studio_flow_audit
					 WHERE owner_owui_user_id = ?
					 ORDER BY created_at ASC, id ASC`
				)
				.all(ownerOwuiUserId) as FlowAuditRow[]
		).map(record);
	}
}

function record(row: FlowAuditRow): FlowAuditRecord {
	return {
		id: row.id,
		ownerOwuiUserId: row.owner_owui_user_id,
		action: row.action,
		flowId: row.flow_id,
		flowVersion: row.flow_version,
		executionId: row.execution_id,
		executionState: row.execution_state,
		errorCode: row.error_code,
		createdAt: row.created_at
	};
}
