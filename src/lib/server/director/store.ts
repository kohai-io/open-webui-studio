import { createHash, randomUUID } from 'node:crypto';
import type { StudioDatabase } from '$lib/server/database/database';
import { encryptJson, decryptJson } from '$lib/server/sessions/crypto';
import { DirectorError, identifier, text, validateDocument } from '$lib/director/validation';
import {
	emptyProject,
	terminal,
	type Project,
	type ProjectDocument,
	type Job,
	type JobInput,
	type JobState
} from '$lib/director/types';
import { INSTRUCTION_VERSION, jobPrompt } from './instructions';
type ProjectRow = {
	id: string;
	revision: number;
	archived: number;
	encrypted_document: string;
	updated_at: number;
};
type JobRow = {
	id: string;
	project_id: string;
	owner_id: string;
	input_hash: string;
	state: JobState;
	encrypted_payload: string;
	encrypted_credential: string | null;
	credential_expires_at: number;
	claim_token: string;
	updated_at: number;
	created_at: number;
};
export interface ClaimedJob {
	job: Job;
	ownerId: string;
	token: string;
	claimToken: string;
}
export class DirectorStore {
	constructor(
		readonly db: StudioDatabase,
		private key: Buffer,
		private now = Date.now
	) {}
	list(owner: string): Project[] {
		return (
			this.db
				.prepare(
					'SELECT * FROM studio_director_project WHERE owner_id=? ORDER BY updated_at DESC LIMIT 100'
				)
				.all(owner) as ProjectRow[]
		).map((r) => this.project(r));
	}
	get(owner: string, id: string): Project {
		const row = this.db
			.prepare('SELECT * FROM studio_director_project WHERE id=? AND owner_id=?')
			.get(id, owner) as ProjectRow | undefined;
		if (!row) throw new DirectorError('not_found', 404);
		return this.project(row);
	}
	private project(row: ProjectRow): Project {
		return {
			...decryptJson<ProjectDocument>(row.encrypted_document, this.key),
			id: row.id,
			revision: row.revision,
			archived: !!row.archived,
			updatedAt: row.updated_at
		};
	}
	create(owner: string, name: unknown, source?: ProjectDocument): Project {
		const doc = validateDocument(
			source
				? { ...source, name, shots: source.shots.map((s) => ({ ...s, acceptedTakeId: '' })) }
				: emptyProject(text(name, 200))
		);
		const id = randomUUID();
		const encrypted = encryptJson(doc, this.key);
		this.db.transaction(() => {
			this.db
				.prepare('INSERT INTO studio_director_project VALUES (?,?,1,?,0,?)')
				.run(id, owner, encrypted, this.now());
			this.db.prepare('INSERT INTO studio_director_revision VALUES (?,1,?)').run(id, encrypted);
		})();
		return this.get(owner, id);
	}
	save(owner: string, id: string, revision: unknown, value: unknown, archived?: boolean): Project {
		const doc = validateDocument(value);
		return this.db.transaction(() => {
			const current = this.get(owner, id);
			if (current.revision !== revision) throw new DirectorError('revision_conflict', 409);
			for (const shot of doc.shots)
				if (shot.acceptedTakeId) {
					const job = this.getJob(owner, id, shot.acceptedTakeId);
					if (
						job.input.kind !== 'video' ||
						job.input.shotId !== shot.id ||
						job.state !== 'succeeded'
					)
						throw new DirectorError('invalid_take');
				}
			const encrypted = encryptJson(doc, this.key);
			this.db
				.prepare(
					'UPDATE studio_director_project SET revision=revision+1,encrypted_document=?,archived=?,updated_at=? WHERE id=? AND owner_id=?'
				)
				.run(encrypted, (archived ?? current.archived) ? 1 : 0, this.now(), id, owner);
			this.db
				.prepare('INSERT INTO studio_director_revision VALUES (?,?,?)')
				.run(id, current.revision + 1, encrypted);
			return this.get(owner, id);
		})();
	}
	undo(owner: string, id: string, revision: number): Project {
		const current = this.get(owner, id);
		if (current.revision !== revision) throw new DirectorError('revision_conflict', 409);
		const row = this.db
			.prepare(
				'SELECT encrypted_document FROM studio_director_revision WHERE project_id=? AND revision=?'
			)
			.get(id, revision - 1) as { encrypted_document: string } | undefined;
		if (!row) throw new DirectorError('nothing_to_undo');
		return this.save(owner, id, revision, decryptJson(row.encrypted_document, this.key));
	}
	jobs(owner: string, projectId: string): Job[] {
		const project = this.get(owner, projectId);
		const recent = (
			this.db
				.prepare(
					'SELECT * FROM studio_director_job WHERE project_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 300'
				)
				.all(projectId, owner) as JobRow[]
		).map((row) => this.job(row));
		const ids = new Set(recent.map((j) => j.id));
		for (const shot of project.shots)
			if (shot.acceptedTakeId && !ids.has(shot.acceptedTakeId)) {
				recent.push(this.getJob(owner, projectId, shot.acceptedTakeId));
				ids.add(shot.acceptedTakeId);
			}
		return recent;
	}
	getJob(owner: string, projectId: string, id: string): Job {
		const row = this.db
			.prepare('SELECT * FROM studio_director_job WHERE id=? AND owner_id=? AND project_id=?')
			.get(id, owner, projectId) as JobRow | undefined;
		if (!row) throw new DirectorError('not_found', 404);
		return this.job(row);
	}
	private job(row: JobRow): Job {
		return {
			...decryptJson<Job>(row.encrypted_payload, this.key),
			id: row.id,
			projectId: row.project_id,
			state: row.state,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		};
	}
	queue(
		owner: string,
		projectId: string,
		input: JobInput,
		idempotencyKey: string,
		token: string,
		expiresAt: number
	): Job {
		identifier(idempotencyKey);
		if (
			!['storyboard', 'revise', 'first-frame', 'last-frame', 'reference', 'video'].includes(
				input.kind
			)
		)
			throw new DirectorError('invalid_operation');
		text(input.instruction, 8000);
		identifier(input.shotId, true);
		identifier(input.referenceId, true);
		const hash = createHash('sha256').update(JSON.stringify({ projectId, input })).digest('hex');
		return this.db.transaction(() => {
			const existing = this.db
				.prepare('SELECT * FROM studio_director_job WHERE owner_id=? AND idempotency_key=?')
				.get(owner, idempotencyKey) as JobRow | undefined;
			if (existing) {
				if (existing.input_hash !== hash) throw new DirectorError('idempotency_conflict', 409);
				return this.job(existing);
			}
			const project = this.get(owner, projectId);
			if (project.archived) throw new DirectorError('project_archived', 409);
			if (project.revision !== input.projectRevision)
				throw new DirectorError('revision_conflict', 409);
			if (expiresAt <= this.now()) throw new DirectorError('authentication_required', 401);
			const count = this.db
				.prepare(
					"SELECT count(*) AS n FROM studio_director_job WHERE owner_id=? AND state IN ('queued','submitting','running')"
				)
				.get(owner) as { n: number };
			if (count.n >= 20) throw new DirectorError('queue_full', 429);
			if (
				['revise', 'first-frame', 'last-frame', 'video'].includes(input.kind) &&
				!project.shots.some((s) => s.id === input.shotId)
			)
				throw new DirectorError('shot_required');
			if (input.kind === 'reference' && !project.references.some((r) => r.id === input.referenceId))
				throw new DirectorError('reference_required');
			if (['storyboard', 'revise'].includes(input.kind) && !project.modelId)
				throw new DirectorError('model_required');
			if (input.kind === 'video' && !project.videoModelId)
				throw new DirectorError('video_model_required');
			const snapshot = validateDocument(project);
			const id = randomUUID();
			const now = this.now();
			const job: Job = {
				id,
				projectId,
				input,
				snapshot,
				prompt: jobPrompt(snapshot, input),
				instructionVersion: INSTRUCTION_VERSION,
				state: 'queued',
				createdAt: now,
				updatedAt: now
			};
			this.db
				.prepare(
					'INSERT INTO studio_director_job (id,project_id,owner_id,idempotency_key,input_hash,state,encrypted_payload,encrypted_credential,credential_expires_at,next_poll_at,updated_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
				)
				.run(
					id,
					projectId,
					owner,
					idempotencyKey,
					hash,
					'queued',
					encryptJson(job, this.key),
					encryptJson({ token }, this.key),
					expiresAt,
					now,
					now,
					now
				);
			return job;
		})();
	}
	claim(): ClaimedJob | null {
		return this.db.transaction(() => {
			const now = this.now();
			// Never replay an operation interrupted while its remote acceptance was unknown.
			this.db
				.prepare(
					"UPDATE studio_director_job SET state='submission-unknown',encrypted_credential=NULL,claim_token=NULL,claim_until=NULL WHERE state='submitting' AND claim_until < ?"
				)
				.run(now);
			this.db
				.prepare(
					"UPDATE studio_director_job SET state='authentication-required',encrypted_credential=NULL,claim_token=NULL,claim_until=NULL WHERE state IN ('queued','running') AND credential_expires_at <= ? AND (claim_until IS NULL OR claim_until < ?)"
				)
				.run(now, now);
			const row = this.db
				.prepare(
					"SELECT * FROM studio_director_job WHERE state IN ('queued','running') AND next_poll_at <= ? AND (claim_until IS NULL OR claim_until < ?) ORDER BY next_poll_at,created_at LIMIT 1"
				)
				.get(now, now) as JobRow | undefined;
			if (!row || !row.encrypted_credential) return null;
			const claimToken = randomUUID();
			this.db
				.prepare('UPDATE studio_director_job SET claim_token=?,claim_until=? WHERE id=?')
				.run(claimToken, now + 30_000, row.id);
			return {
				job: this.job(row),
				ownerId: row.owner_id,
				token: decryptJson<{ token: string }>(row.encrypted_credential, this.key).token,
				claimToken
			};
		})();
	}
	heartbeat(id: string, claim: string): boolean {
		return (
			this.db
				.prepare('UPDATE studio_director_job SET claim_until=? WHERE id=? AND claim_token=?')
				.run(this.now() + 30_000, id, claim).changes === 1
		);
	}
	checkpoint(job: Job, claim: string, release = false) {
		const result = this.db
			.prepare(
				'UPDATE studio_director_job SET state=?,encrypted_payload=?,updated_at=?,next_poll_at=?,claim_token=?,claim_until=?,encrypted_credential=CASE WHEN ? THEN NULL ELSE encrypted_credential END WHERE id=? AND claim_token=?'
			)
			.run(
				job.state,
				encryptJson(job, this.key),
				this.now(),
				this.now() + (job.state === 'running' ? 5000 : 0),
				release ? null : claim,
				release ? null : this.now() + 30_000,
				terminal(job.state) ? 1 : 0,
				job.id,
				claim
			);
		if (!result.changes) throw new DirectorError('lost_claim', 409);
	}
	cancel(owner: string, projectId: string, id: string) {
		const job = this.getJob(owner, projectId, id);
		if (job.state !== 'queued') throw new DirectorError('already_submitted', 409);
		const result = this.db
			.prepare(
				"UPDATE studio_director_job SET state='cancelled',encrypted_credential=NULL WHERE id=? AND state='queued' AND claim_token IS NULL"
			)
			.run(id);
		if (!result.changes) throw new DirectorError('already_submitted', 409);
	}
	resume(owner: string, projectId: string, id: string, token: string, expiresAt: number) {
		const job = this.getJob(owner, projectId, id);
		if (!(
			job.state === 'authentication-required' ||
			(job.state === 'submission-unknown' && job.input.kind === 'video')
		))
			throw new DirectorError('cannot_resume', 409);
		if (expiresAt <= this.now()) throw new DirectorError('authentication_required', 401);
		if (job.state === 'submission-unknown' && job.input.kind === 'video')
			job.providerJobId = job.id;
		const next = job.providerJobId ? 'running' : 'queued';
		this.db
			.prepare(
				'UPDATE studio_director_job SET state=?,encrypted_payload=?,encrypted_credential=?,credential_expires_at=?,next_poll_at=? WHERE id=?'
			)
			.run(
				next,
				encryptJson(job, this.key),
				encryptJson({ token }, this.key),
				expiresAt,
				this.now(),
				id
			);
	}
	review(owner: string, projectId: string, id: string, note: unknown) {
		const job = this.getJob(owner, projectId, id);
		if (!terminal(job.state)) throw new DirectorError('job_not_ready', 409);
		job.note = text(note, 8000);
		this.db
			.prepare('UPDATE studio_director_job SET encrypted_payload=? WHERE id=?')
			.run(encryptJson(job, this.key), id);
	}
	apply(owner: string, projectId: string, id: string, revision: number, fileId?: string) {
		return this.db.transaction(() => {
			const job = this.getJob(owner, projectId, id);
			const project = this.get(owner, projectId);
			if (job.state !== 'succeeded') throw new DirectorError('job_not_ready', 409);
			if (job.proposal) {
				if (job.input.projectRevision !== revision)
					throw new DirectorError('proposal_outdated', 409);
				if (job.input.kind === 'revise')
					project.shots = project.shots.map((s) =>
						s.id === job.input.shotId ? job.proposal![0] : s
					);
				else project.shots.push(...job.proposal.map((s) => ({ ...s, id: randomUUID() })));
			} else {
				if (!fileId || !job.fileIds?.includes(fileId)) throw new DirectorError('invalid_asset');
				if (job.input.kind === 'reference') {
					const ref = project.references.find((r) => r.id === job.input.referenceId);
					if (!ref) throw new DirectorError('reference_required');
					ref.fileId = fileId;
				} else {
					const shot = project.shots.find((s) => s.id === job.input.shotId);
					if (!shot) throw new DirectorError('shot_required');
					if (job.input.kind === 'video') shot.acceptedTakeId = id;
					else if (job.input.kind === 'first-frame') shot.firstFrame = fileId;
					else if (job.input.kind === 'last-frame') shot.lastFrame = fileId;
				}
			}
			return this.save(owner, projectId, revision, project);
		})();
	}
}
