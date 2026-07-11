import { createHash, randomUUID } from 'node:crypto';
import type { StudioDatabase } from '$lib/server/database/database';
import {
	FlowDefinitionError,
	type FlowDefinitionV1,
	type FlowValidationIssue,
	validateFlowDefinition
} from './definition';
import { appendFlowAudit } from './audit';

export type FlowStoreErrorCode =
	'not_found' | 'validation_failed' | 'conflict' | 'active_execution';

export class FlowStoreError extends Error {
	constructor(
		public readonly code: FlowStoreErrorCode,
		public readonly issues: FlowValidationIssue[] = []
	) {
		super(code);
		this.name = 'FlowStoreError';
	}
}

export interface FlowCreateInput {
	name: unknown;
	description?: unknown;
	definition: unknown;
}

export interface FlowUpdateInput {
	expectedRevision: number;
	name?: unknown;
	description?: unknown;
	definition?: unknown;
}

export interface FlowSummary {
	id: string;
	name: string;
	description: string | null;
	currentVersion: number;
	revision: number;
	createdAt: number;
	updatedAt: number;
}

export interface FlowRecord extends FlowSummary {
	definition: FlowDefinitionV1;
	definitionHash: string;
}

export interface FlowVersionRecord {
	flowId: string;
	version: number;
	name: string;
	description: string | null;
	definition: FlowDefinitionV1;
	definitionHash: string;
	createdAt: number;
}

interface CurrentFlowRow {
	id: string;
	name: string;
	description: string | null;
	current_version: number;
	revision: number;
	created_at: number;
	updated_at: number;
	definition_json: string;
	definition_hash: string;
}

interface FlowSummaryRow {
	id: string;
	name: string;
	description: string | null;
	current_version: number;
	revision: number;
	created_at: number;
	updated_at: number;
}

interface FlowVersionRow {
	flow_id: string;
	version: number;
	name: string;
	description: string | null;
	definition_json: string;
	definition_hash: string;
	created_at: number;
}

export interface FlowStoreOptions {
	now?: () => number;
	nextId?: () => string;
}

export class FlowStore {
	private readonly now: () => number;
	private readonly nextId: () => string;

	constructor(
		private readonly database: StudioDatabase,
		options: FlowStoreOptions = {}
	) {
		this.now = options.now ?? Date.now;
		this.nextId = options.nextId ?? randomUUID;
	}

	create(ownerOwuiUserId: string, input: FlowCreateInput): FlowRecord {
		const owner = ownerId(ownerOwuiUserId);
		const name = flowName(input.name);
		const description = flowDescription(input.description);
		const validatedDefinition = flowDefinition(input.definition);
		const encoded = JSON.stringify(validatedDefinition);
		const hash = definitionHash(encoded);
		const id = this.nextId();
		const now = this.now();

		this.database.transaction(() => {
			this.database
				.prepare(
					`INSERT INTO studio_flow
					 (id, owner_owui_user_id, name, description, current_version, revision, created_at, updated_at)
					 VALUES (?, ?, ?, ?, 1, 1, ?, ?)`
				)
				.run(id, owner, name, description, now, now);
			this.insertVersion(id, 1, owner, name, description, encoded, hash, now);
			appendFlowAudit(this.database, {
				ownerOwuiUserId: owner,
				action: 'flow_created',
				flowId: id,
				flowVersion: 1,
				createdAt: now
			});
		})();
		return this.require(owner, id);
	}

	list(ownerOwuiUserId: string): FlowSummary[] {
		const owner = ownerId(ownerOwuiUserId);
		const rows = this.database
			.prepare(
				`SELECT id, name, description, current_version, revision, created_at, updated_at
				 FROM studio_flow
				 WHERE owner_owui_user_id = ?
				 ORDER BY updated_at DESC, id ASC`
			)
			.all(owner) as FlowSummaryRow[];
		return rows.map(summary);
	}

	get(ownerOwuiUserId: string, id: string): FlowRecord | null {
		const row = this.current(ownerId(ownerOwuiUserId), flowId(id));
		return row ? record(row) : null;
	}

	listVersions(ownerOwuiUserId: string, id: string): FlowVersionRecord[] {
		const owner = ownerId(ownerOwuiUserId);
		const safeId = flowId(id);
		if (!this.current(owner, safeId)) throw new FlowStoreError('not_found');
		const rows = this.database
			.prepare(
				`SELECT v.flow_id, v.version, v.name, v.description, v.definition_json,
				        v.definition_hash, v.created_at
				 FROM studio_flow_version v
				 JOIN studio_flow f ON f.id = v.flow_id
				 WHERE v.flow_id = ? AND f.owner_owui_user_id = ?
				 ORDER BY v.version DESC`
			)
			.all(safeId, owner) as FlowVersionRow[];
		return rows.map(versionRecord);
	}

	update(ownerOwuiUserId: string, id: string, input: FlowUpdateInput): FlowRecord {
		const owner = ownerId(ownerOwuiUserId);
		const safeId = flowId(id);
		if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1)
			throw validationError('$.expectedRevision', 'invalid_value');

		this.database.transaction(() => {
			const current = this.current(owner, safeId);
			if (!current) throw new FlowStoreError('not_found');
			if (current.revision !== input.expectedRevision) throw new FlowStoreError('conflict');

			const name = input.name === undefined ? current.name : flowName(input.name);
			const description =
				input.description === undefined ? current.description : flowDescription(input.description);
			const validated =
				input.definition === undefined
					? flowDefinition(JSON.parse(current.definition_json))
					: flowDefinition(input.definition);
			const encoded = JSON.stringify(validated);
			const hash = definitionHash(encoded);
			const nextVersion = current.current_version + 1;
			const nextRevision = current.revision + 1;
			const now = this.now();

			this.insertVersion(safeId, nextVersion, owner, name, description, encoded, hash, now);
			const result = this.database
				.prepare(
					`UPDATE studio_flow
					 SET name = ?, description = ?, current_version = ?, revision = ?, updated_at = ?
					 WHERE id = ? AND owner_owui_user_id = ? AND revision = ?`
				)
				.run(
					name,
					description,
					nextVersion,
					nextRevision,
					now,
					safeId,
					owner,
					input.expectedRevision
				);
			if (result.changes !== 1) throw new FlowStoreError('conflict');
			appendFlowAudit(this.database, {
				ownerOwuiUserId: owner,
				action: 'flow_updated',
				flowId: safeId,
				flowVersion: nextVersion,
				createdAt: now
			});
		})();
		return this.require(owner, safeId);
	}

	delete(ownerOwuiUserId: string, id: string): void {
		const owner = ownerId(ownerOwuiUserId);
		const safeId = flowId(id);
		this.database.transaction(() => {
			if (!this.current(owner, safeId)) throw new FlowStoreError('not_found');
			const active = this.database
				.prepare(
					`SELECT 1 FROM studio_flow_execution
					 WHERE flow_id = ? AND owner_owui_user_id = ?
					   AND state IN ('queued', 'running', 'cancel_requested')
					 LIMIT 1`
				)
				.get(safeId, owner);
			if (active) throw new FlowStoreError('active_execution');
			appendFlowAudit(this.database, {
				ownerOwuiUserId: owner,
				action: 'flow_deleted',
				flowId: safeId,
				flowVersion: this.current(owner, safeId)!.current_version,
				createdAt: this.now()
			});
			this.database
				.prepare('DELETE FROM studio_flow WHERE id = ? AND owner_owui_user_id = ?')
				.run(safeId, owner);
		})();
	}

	private current(owner: string, id: string): CurrentFlowRow | undefined {
		return this.database
			.prepare(
				`SELECT f.id, f.name, f.description, f.current_version, f.revision,
				        f.created_at, f.updated_at, v.definition_json, v.definition_hash
				 FROM studio_flow f
				 JOIN studio_flow_version v
				   ON v.flow_id = f.id AND v.version = f.current_version
				 WHERE f.id = ? AND f.owner_owui_user_id = ?`
			)
			.get(id, owner) as CurrentFlowRow | undefined;
	}

	private require(owner: string, id: string): FlowRecord {
		const row = this.current(owner, id);
		if (!row) throw new FlowStoreError('not_found');
		return record(row);
	}

	private insertVersion(
		flowId: string,
		version: number,
		owner: string,
		name: string,
		description: string | null,
		definitionJson: string,
		hash: string,
		createdAt: number
	) {
		this.database
			.prepare(
				`INSERT INTO studio_flow_version
				 (flow_id, version, name, description, definition_json, definition_hash,
				  owner_owui_user_id, created_by_owui_user_id, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(flowId, version, name, description, definitionJson, hash, owner, owner, createdAt);
	}
}

function flowDefinition(value: unknown): FlowDefinitionV1 {
	try {
		return validateFlowDefinition(value);
	} catch (error) {
		if (error instanceof FlowDefinitionError)
			throw new FlowStoreError('validation_failed', error.issues);
		throw error;
	}
}

function ownerId(value: string): string {
	if (!value || value.length > 256) throw validationError('$.owner', 'invalid_value');
	return value;
}

function flowId(value: string): string {
	if (!value || value.length > 128) throw validationError('$.id', 'invalid_value');
	return value;
}

function flowName(value: unknown): string {
	if (typeof value !== 'string') throw validationError('$.name', 'invalid_type');
	const name = value.trim();
	if (!name) throw validationError('$.name', 'required');
	if (name.length > 120) throw validationError('$.name', 'too_long');
	return name;
}

function flowDescription(value: unknown): string | null {
	if (value === undefined || value === null || value === '') return null;
	if (typeof value !== 'string') throw validationError('$.description', 'invalid_type');
	if (value.length > 1000) throw validationError('$.description', 'too_long');
	return value;
}

function validationError(path: string, code: FlowValidationIssue['code']): FlowStoreError {
	return new FlowStoreError('validation_failed', [{ path, code }]);
}

function definitionHash(encoded: string): string {
	return createHash('sha256').update(encoded, 'utf8').digest('hex');
}

function summary(row: FlowSummaryRow): FlowSummary {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		currentVersion: row.current_version,
		revision: row.revision,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function record(row: CurrentFlowRow): FlowRecord {
	return {
		...summary(row),
		definition: validateFlowDefinition(JSON.parse(row.definition_json)),
		definitionHash: row.definition_hash
	};
}

function versionRecord(row: FlowVersionRow): FlowVersionRecord {
	return {
		flowId: row.flow_id,
		version: row.version,
		name: row.name,
		description: row.description,
		definition: validateFlowDefinition(JSON.parse(row.definition_json)),
		definitionHash: row.definition_hash,
		createdAt: row.created_at
	};
}
