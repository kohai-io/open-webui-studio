import { describe, expect, it } from 'vitest';
import { emptyProject, emptyShot, type Job } from './types';
import {
	acceptance,
	emptyReviewView,
	matchesReview,
	reviewItems,
	restoreReviewView
} from './review';
const project = { ...emptyProject(), shots: [emptyShot('s1'), emptyShot('s2')] };
const job = (
	id: string,
	kind: Job['input']['kind'],
	time: number,
	extra: Partial<Job> = {}
): Job => ({
	id,
	projectId: 'p',
	state: 'succeeded',
	createdAt: time,
	updatedAt: time + 1000,
	input: { kind, shotId: 's1', referenceId: '', projectRevision: 1, instruction: '' },
	snapshot: structuredClone(project),
	prompt: '',
	instructionVersion: 'v1',
	fileIds: [id + '-file'],
	...extra
});
describe('take review', () => {
	it('keeps operation numbers through filtering, failures and multiple outputs', () => {
		const items = reviewItems([
			job('v3', 'video', 4, { reviewNumber: 8 }),
			job('v2', 'video', 3, { state: 'failed', fileIds: [], reviewNumber: 7 }),
			job('f', 'first-frame', 2, { fileIds: ['a', 'b'] }),
			job('v1', 'video', 1, { reviewNumber: 6 })
		]);
		expect(items.map((i) => i.label)).toEqual([
			'Take 8',
			'Take 7',
			'Frame 1.1',
			'Frame 1.2',
			'Take 6'
		]);
		expect(
			items
				.filter((i) => matchesReview(i, 's1', { ...emptyReviewView(), status: 'failed' }, project))
				.map((i) => i.label)
		).toEqual(['Take 7']);
		expect(items.filter((i) => matchesReview(i, 's2', emptyReviewView(), project))).toHaveLength(0);
		expect(items[2].key).not.toBe(items[3].key);
	});
	it('recognizes the current crop source and never confuses its reference with a shot', () => {
		const doc = structuredClone(project);
		doc.shots[0].firstFrame = 'crop';
		doc.shots[0].firstFrameCrop = { sourceFileId: 'f-file', ratio: '16:9', x: 50, y: 50, zoom: 1 };
		expect(acceptance(reviewItems([job('f', 'first-frame', 1)])[0], doc)).toBe(
			'Source of current crop'
		);
		const reference = job('r', 'reference', 2);
		reference.input.referenceId = 'ref';
		reference.snapshot.references = [
			{ id: 'ref', name: 'Character', role: 'identity', fileId: '', description: '' }
		];
		expect(reviewItems([reference])[0].title).toBe('Character');
	});
	it('falls back safely when a stored view is missing or invalid', () => {
		expect(restoreReviewView(null)).toEqual(emptyReviewView());
		expect(restoreReviewView({ kind: 'unknown', status: 'wrong', key: 3 })).toEqual(
			emptyReviewView()
		);
		expect(restoreReviewView({ kind: 'video', status: 'accepted', key: 'job:1' })).toEqual({
			kind: 'video',
			status: 'accepted',
			key: 'job:1'
		});
	});
});
