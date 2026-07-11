import { randomUUID } from 'node:crypto';
import type { StudioDatabase } from '$lib/server/database/database';

export interface StudioAgent {
	id: string;
	name: string;
	description: string;
	modelId: string;
	createdAt: number;
	updatedAt: number;
}

export class AgentStore {
	constructor(
		private readonly database: StudioDatabase,
		private readonly now: () => number = Date.now
	) {}

	list(ownerId: string): StudioAgent[] {
		return (
			this.database
				.prepare(
					`SELECT id, name, description, model_id, created_at, updated_at
					 FROM studio_agent WHERE owner_owui_user_id = ? ORDER BY updated_at DESC, name`
				)
				.all(ownerId) as AgentRow[]
		).map(agent);
	}

	get(ownerId: string, id: string): StudioAgent | null {
		const row = this.database
			.prepare(
				`SELECT id, name, description, model_id, created_at, updated_at
				 FROM studio_agent WHERE owner_owui_user_id = ? AND id = ?`
			)
			.get(ownerId, id) as AgentRow | undefined;
		return row ? agent(row) : null;
	}

	create(ownerId: string, input: { name: string; description: string; modelId: string }) {
		const now = this.now();
		const value: StudioAgent = { id: randomUUID(), ...input, createdAt: now, updatedAt: now };
		this.database
			.prepare(
				`INSERT INTO studio_agent
				 (id, owner_owui_user_id, name, description, model_id, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.run(value.id, ownerId, value.name, value.description, value.modelId, now, now);
		return value;
	}

	delete(ownerId: string, id: string): boolean {
		return (
			this.database
				.prepare('DELETE FROM studio_agent WHERE owner_owui_user_id = ? AND id = ?')
				.run(ownerId, id).changes === 1
		);
	}
}

interface AgentRow {
	id: string;
	name: string;
	description: string;
	model_id: string;
	created_at: number;
	updated_at: number;
}

function agent(row: AgentRow): StudioAgent {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		modelId: row.model_id,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}
