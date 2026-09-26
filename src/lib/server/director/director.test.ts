import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { openStudioDatabase, type StudioDatabase } from '$lib/server/database/database';
import { DirectorStore } from './store';
import { DirectorWorker, type DirectorClient } from './worker';
import { emptyShot, type JobInput, type Project } from '$lib/director/types';
import { isTakeStale } from '$lib/director/staleness';
import { videoFailureMessage } from '$lib/director/video';
import { bytes, exportManifest, zip } from './export';
let db: StudioDatabase;
let store: DirectorStore;
let clock: number;
let project: Project;
const key = randomBytes(32);
function input(kind: JobInput['kind'] = 'video'): JobInput {
	return {
		kind,
		projectRevision: project.revision,
		shotId: 'shot-1',
		referenceId: '',
		instruction: ''
	};
}
function queue(kind: JobInput['kind'] = 'video', id = randomUUID()) {
	return store.queue('alice', project.id, input(kind), id, 'private-token', clock + 3600000);
}
function fakeClient() {
	return {
		completeText: vi.fn(async () => ({
			modelId: 'text-model',
			content: '{"shots":[{"title":"Arrival","action":"A train arrives","duration":5}]}',
			requestId: 'request'
		})),
		createImages: vi.fn(async () => ({ kind: 'images' as const, fileIds: ['image-1'] })),
		resolveImages: vi.fn(async () => ({ kind: 'images' as const, fileIds: ['image-1'] })),
		directorVideo: vi.fn(
			async (_model: string, cmd: Record<string, unknown>): Promise<Record<string, unknown>> =>
				cmd.operation === 'capabilities'
					? { protocol: 1, enabled: true }
					: {
							jobId: cmd.jobId,
							state: cmd.operation === 'submit' ? 'running' : 'succeeded',
							fileIds: ['video-1']
						}
		),
		getOwnedMedia: vi.fn(async () => ({
			id: 'video-1',
			filename: 'video.mp4',
			mediaType: 'video' as const,
			contentType: 'video/mp4',
			size: 10,
			createdAt: 1,
			updatedAt: 1
		}))
	} satisfies DirectorClient;
}
beforeEach(() => {
	clock = 100000;
	db = openStudioDatabase(':memory:');
	store = new DirectorStore(db, key, () => clock);
	project = store.create('alice', 'Signal');
	project.shots = [
		{ ...emptyShot('shot-1'), action: 'A train arrives' },
		emptyShot('shot-2'),
		emptyShot('shot-3')
	];
	project.modelId = 'text-model';
	project.videoModelId = 'runway';
	project = store.save('alice', project.id, project.revision, project);
});
afterEach(() => db.close());
describe('Director production lifecycle', () => {
	it('retains moderation diagnostics across reload and never retries a failed generation', async () => {
		const job = queue();
		const taskId = randomUUID();
		const client = fakeClient();
		client.directorVideo.mockImplementation(async (_model, cmd) =>
			cmd.operation === 'capabilities'
				? { protocol: 1, enabled: true }
				: {
						jobId: cmd.jobId,
						providerTaskId: taskId,
						state: cmd.operation === 'submit' ? 'running' : 'failed',
						failureCode: 'INPUT_PREPROCESSING.SAFETY.THIRD_PARTY',
						failure: 'secret raw provider response'
					}
		);
		const worker = new DirectorWorker(store, () => client);
		await worker.runOnce();
		expect(store.getJob('alice', project.id, job.id).providerTaskId).toBe(taskId);
		clock += 6000;
		await worker.runOnce();
		const result = new DirectorStore(db, key, () => clock).getJob('alice', project.id, job.id);
		expect(result).toMatchObject({
			state: 'failed',
			providerTaskId: taskId,
			failureCode: 'INPUT_PREPROCESSING.SAFETY.THIRD_PARTY',
			providerJobId: job.id
		});
		expect(videoFailureMessage(result.failureCode)).toContain('Blocked by provider moderation');
		expect(JSON.stringify(result)).not.toContain('secret raw');
		expect(() => store.getJob('bob', project.id, job.id)).toThrow('not_found');
		clock += 6000;
		expect(await worker.runOnce()).toBe(false);
		expect(
			client.directorVideo.mock.calls.filter(([, cmd]) => cmd.operation === 'submit')
		).toHaveLength(1);
	});
	it.each([
		{},
		{ providerTaskId: 'https://private.test?key=secret', failureCode: 'Bearer secret' }
	])('handles older pipes and rejects arbitrary diagnostic data: %j', async (diagnostics) => {
		const job = queue();
		const client = fakeClient();
		const worker = new DirectorWorker(store, () => client);
		await worker.runOnce();
		client.directorVideo.mockResolvedValueOnce({ jobId: job.id, state: 'failed', ...diagnostics });
		clock += 6000;
		await worker.runOnce();
		const result = store.getJob('alice', project.id, job.id);
		expect(result.state).toBe('failed');
		expect(result.providerTaskId).toBeUndefined();
		expect(result.failureCode).toBeUndefined();
		expect(videoFailureMessage(result.failureCode)).toContain(
			'Video generation failed at the provider'
		);
	});
	it.each(['first-frame', 'last-frame'] as const)(
		'does not mark an accepted %s stale, but catches changed inputs',
		async (kind) => {
			const job = queue(kind);
			await new DirectorWorker(store, () => fakeClient()).runOnce();
			const result = store.getJob('alice', project.id, job.id);
			const accepted = store.apply('alice', project.id, job.id, project.revision, 'image-1');
			expect(isTakeStale(result, accepted)).toBe(false);
			accepted.shots[0].dialogue = 'A new line';
			accepted.shots[0].duration = 7;
			expect(isTakeStale(result, accepted)).toBe(false);
			accepted.shots[0].framePrompt = 'Different lighting';
			expect(isTakeStale(result, accepted)).toBe(true);
		}
	);
	it('detects changed reference files and video inputs after acceptance', async () => {
		project.references = [
			{ id: 'ref-1', name: 'Location', role: 'location', description: '', fileId: 'image-ref' }
		];
		project.shots[0].referenceIds = ['ref-1'];
		project = store.save('alice', project.id, project.revision, project);
		const job = queue('first-frame');
		await new DirectorWorker(store, () => fakeClient()).runOnce();
		const result = store.getJob('alice', project.id, job.id);
		const current = store.apply('alice', project.id, job.id, project.revision, 'image-1');
		expect(isTakeStale(result, current)).toBe(false);
		current.references[0].fileId = 'replacement-image';
		expect(isTakeStale(result, current)).toBe(true);
		const video = {
			...result,
			input: { ...result.input, kind: 'video' as const },
			snapshot: structuredClone(current)
		};
		current.shots[0].acceptedTakeId = video.id;
		expect(isTakeStale(video, current)).toBe(false);
		current.shots[0].duration = 9;
		expect(isTakeStale(video, current)).toBe(true);
	});
	it('resumes video work that expired before submission as queued work', async () => {
		const job = queue();
		clock += 3600001;
		expect(store.claim()).toBeNull();
		store.resume('alice', project.id, job.id, 'renewed', clock + 100000);
		const client = fakeClient();
		await new DirectorWorker(store, () => client).runOnce();
		expect(
			client.directorVideo.mock.calls.filter(([, cmd]) => cmd.operation === 'submit')
		).toHaveLength(1);
	});
	it('preserves unknown outcome when a video submission returns malformed task data', async () => {
		const job = queue();
		const client = fakeClient();
		client.directorVideo
			.mockImplementationOnce(async () => ({ protocol: 1, enabled: true }))
			.mockResolvedValueOnce({ jobId: 'wrong', state: 'running', fileIds: [] });
		await new DirectorWorker(store, () => client).runOnce();
		expect(store.getJob('alice', project.id, job.id).state).toBe('submission-unknown');
	});
	it('isolates owners, rejects stale saves and restores the previous revision', () => {
		expect(() => store.get('bob', project.id)).toThrow('not_found');
		expect(() => store.save('alice', project.id, 1, project)).toThrow('revision_conflict');
		const updated = store.save('alice', project.id, project.revision, {
			...project,
			name: 'New title'
		});
		expect(store.undo('alice', project.id, updated.revision).name).toBe('Signal');
		const raw = JSON.stringify(db.prepare('SELECT * FROM studio_director_project').all());
		expect(raw).not.toContain('Signal');
	});
	it('deduplicates identical submissions and rejects reuse with changed inputs', () => {
		const id = randomUUID();
		const first = queue('video', id);
		expect(queue('video', id).id).toBe(first.id);
		expect(() =>
			store.queue(
				'alice',
				project.id,
				{ ...input(), instruction: 'Different' },
				id,
				'token',
				clock + 1000
			)
		).toThrow('idempotency_conflict');
		expect(() => store.getJob('bob', project.id, first.id)).toThrow('not_found');
	});
	it('marks interrupted submission unknown rather than automatically replaying it', () => {
		const job = queue('first-frame');
		const claim = store.claim()!;
		claim.job.state = 'submitting';
		store.checkpoint(claim.job, claim.claimToken);
		clock += 31000;
		expect(store.claim()).toBeNull();
		expect(store.getJob('alice', project.id, job.id).state).toBe('submission-unknown');
	});
	it('recovers known video tasks after worker restart and imports without resubmitting', async () => {
		const job = queue();
		const client = fakeClient();
		await new DirectorWorker(store, () => client).runOnce();
		expect(store.getJob('alice', project.id, job.id).state).toBe('running');
		clock += 6000;
		await new DirectorWorker(new DirectorStore(db, key, () => clock), () => client).runOnce();
		const result = store.getJob('alice', project.id, job.id);
		expect(result.state).toBe('succeeded');
		expect(
			client.directorVideo.mock.calls.filter(([, cmd]) => cmd.operation === 'submit')
		).toHaveLength(1);
		expect(result.fileIds).toEqual(['video-1']);
		expect(store.get('alice', project.id).shots[0].acceptedTakeId).toBe('');
		const accepted = store.apply('alice', project.id, job.id, project.revision, 'video-1');
		expect(accepted.shots.map((s) => s.acceptedTakeId)).toEqual([job.id, '', '']);
	});
	it('keeps a known task after status failure and retries only status', async () => {
		const job = queue();
		const client = fakeClient();
		const worker = new DirectorWorker(store, () => client);
		await worker.runOnce();
		clock += 6000;
		client.directorVideo.mockRejectedValueOnce(new Error('network'));
		await worker.runOnce();
		expect(store.getJob('alice', project.id, job.id).state).toBe('running');
		clock += 6000;
		await worker.runOnce();
		expect(store.getJob('alice', project.id, job.id).state).toBe('succeeded');
		expect(
			client.directorVideo.mock.calls.filter(([, cmd]) => cmd.operation === 'submit')
		).toHaveLength(1);
	});
	it('refuses unsupported last-frame video before any submission', async () => {
		project.shots[0].lastFrame = 'image-last';
		project = store.save('alice', project.id, project.revision, project);
		const job = queue();
		const client = fakeClient();
		await new DirectorWorker(store, () => client).runOnce();
		expect(store.getJob('alice', project.id, job.id).error).toBe('last_frame_not_supported');
		expect(
			client.directorVideo.mock.calls.filter(([, cmd]) => cmd.operation === 'submit')
		).toHaveLength(0);
	});
	it('proposes storyboard changes without overwriting the project and rejects stale application', async () => {
		const job = queue('storyboard');
		const client = fakeClient();
		await new DirectorWorker(store, () => client).runOnce();
		expect(store.get('alice', project.id).shots).toHaveLength(3);
		expect(store.getJob('alice', project.id, job.id).proposal?.[0].title).toBe('Arrival');
		project = store.save('alice', project.id, project.revision, { ...project, brief: 'Changed' });
		expect(() => store.apply('alice', project.id, job.id, project.revision)).toThrow(
			'proposal_outdated'
		);
	});
	it('rejects malformed assistant output without changing shots', async () => {
		const job = queue('storyboard');
		const client = fakeClient();
		client.completeText.mockResolvedValueOnce({
			modelId: 'text-model',
			content: '{"shots":[{"duration":-1}]}',
			requestId: 'r'
		});
		await new DirectorWorker(store, () => client).runOnce();
		expect(store.getJob('alice', project.id, job.id).state).toBe('failed');
		expect(store.get('alice', project.id).shots).toHaveLength(3);
	});
	it('recovers an ambiguous video response by looking up its submission ID, never submitting again', async () => {
		const job = queue();
		const client = fakeClient();
		client.directorVideo
			.mockImplementationOnce(async () => ({ protocol: 1, enabled: true }))
			.mockRejectedValueOnce(new Error('response lost'));
		await new DirectorWorker(store, () => client).runOnce();
		expect(store.getJob('alice', project.id, job.id).state).toBe('submission-unknown');
		store.resume('alice', project.id, job.id, 'renewed-token', clock + 100000);
		await new DirectorWorker(store, () => client).runOnce();
		expect(client.directorVideo.mock.calls.at(-1)?.[1].operation).toBe('status');
		expect(store.getJob('alice', project.id, job.id).state).toBe('succeeded');
	});
	it('expires credentials without discarding task identity and permits status recovery', async () => {
		const job = queue();
		const client = fakeClient();
		await new DirectorWorker(store, () => client).runOnce();
		clock += 3600001;
		expect(store.claim()).toBeNull();
		expect(store.getJob('alice', project.id, job.id).state).toBe('authentication-required');
		store.resume('alice', project.id, job.id, 'new-token', clock + 100000);
		await new DirectorWorker(store, () => client).runOnce();
		expect(store.getJob('alice', project.id, job.id).state).toBe('succeeded');
	});
	it('cancels queued work and retains review notes without changing inputs', () => {
		const job = queue();
		store.cancel('alice', project.id, job.id);
		store.review('alice', project.id, job.id, 'Hold for revision');
		expect(store.claim()).toBeNull();
		const result = store.getJob('alice', project.id, job.id);
		expect(result.note).toBe('Hold for revision');
		expect(result.prompt).toBe(job.prompt);
	});
	it('exports gaps and a standard ZIP central directory', async () => {
		expect(exportManifest(project, []).sequence.map((s) => s.missing)).toEqual([true, true, true]);
		async function* entries() {
			yield { name: 'shot-list.txt', chunks: bytes('Hello') };
		}
		const chunks: Uint8Array[] = [];
		for await (const chunk of zip(entries())) chunks.push(chunk);
		const output = Buffer.concat(chunks);
		expect(output.readUInt32LE(0)).toBe(0x04034b50);
		expect(output.readUInt32LE(output.length - 22)).toBe(0x06054b50);
		expect(output.includes(Buffer.from('shot-list.txt'))).toBe(true);
	});
});
