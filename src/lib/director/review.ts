import type { Job, ProjectDocument } from './types';

export type ReviewKind = 'all' | 'video' | 'frames' | 'reference';
export type ReviewStatus = 'all' | 'accepted' | 'failed' | 'active' | 'attention';
export interface ReviewView {
	key: string;
	kind: ReviewKind;
	status: ReviewStatus;
}
export interface ReviewItem {
	key: string;
	job: Job;
	fileId?: string;
	label: string;
	title: string;
}
export const emptyReviewView = (): ReviewView => ({ key: '', kind: 'all', status: 'all' });
export function restoreReviewView(value: unknown): ReviewView {
	const v = value as Partial<ReviewView> | null;
	return {
		key: typeof v?.key === 'string' ? v.key : '',
		kind: ['all', 'video', 'frames', 'reference'].includes(v?.kind ?? '') ? v!.kind! : 'all',
		status: ['all', 'accepted', 'failed', 'active', 'attention'].includes(v?.status ?? '')
			? v!.status!
			: 'all'
	};
}
export function reviewItems(jobs: Job[]): ReviewItem[] {
	const counts = new Map<string, number>();
	// Server numbers cover the full history. The fallback supports older API responses.
	const ordered = [...jobs].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
	const items: ReviewItem[] = [];
	for (const job of ordered) {
		if (job.proposal) continue;
		const kind = job.input.kind;
		const group = JSON.stringify([
			kind,
			kind === 'reference' ? job.input.referenceId : job.input.shotId
		]);
		const number = job.reviewNumber ?? (counts.get(group) ?? 0) + 1;
		counts.set(group, number);
		const prefix =
			kind === 'video'
				? 'Take'
				: kind === 'first-frame'
					? 'Frame'
					: kind === 'last-frame'
						? 'Last frame'
						: kind === 'reference'
							? 'Reference'
							: 'Proposal';
		const title =
			kind === 'reference'
				? (job.snapshot.references.find((r) => r.id === job.input.referenceId)?.name ?? 'Reference')
				: (job.snapshot.shots.find((s) => s.id === job.input.shotId)?.title ?? 'Planning');
		const files = job.fileIds?.length ? job.fileIds : [undefined];
		files.forEach((fileId, index) =>
			items.push({
				key: job.id + ':' + index,
				job,
				fileId,
				title,
				label: prefix + ' ' + number + (files.length > 1 ? '.' + (index + 1) : '')
			})
		);
	}
	return items.sort(
		(a, b) =>
			b.job.createdAt - a.job.createdAt ||
			b.job.id.localeCompare(a.job.id) ||
			a.key.localeCompare(b.key)
	);
}
export function acceptance(item: ReviewItem, project: ProjectDocument): string {
	if (!item.fileId) return '';
	const shot = project.shots.find((s) => s.id === item.job.input.shotId);
	switch (item.job.input.kind) {
		case 'video':
			return shot?.acceptedTakeId === item.job.id ? 'Accepted' : '';
		case 'first-frame':
			return shot?.firstFrame === item.fileId
				? 'Current frame'
				: shot?.firstFrameCrop?.sourceFileId === item.fileId
					? 'Source of current crop'
					: '';
		case 'last-frame':
			return shot?.lastFrame === item.fileId ? 'Current last frame' : '';
		case 'reference':
			return project.references.some(
				(r) => r.id === item.job.input.referenceId && r.fileId === item.fileId
			)
				? 'Current reference'
				: '';
		default:
			return '';
	}
}
export function matchesReview(
	item: ReviewItem,
	shotId: string,
	view: ReviewView,
	project: ProjectDocument
): boolean {
	const job = item.job;
	if (shotId && job.input.shotId !== shotId) return false;
	if (view.kind === 'video' && job.input.kind !== 'video') return false;
	if (view.kind === 'frames' && !['first-frame', 'last-frame'].includes(job.input.kind))
		return false;
	if (view.kind === 'reference' && job.input.kind !== 'reference') return false;
	if (view.status === 'accepted' && !acceptance(item, project)) return false;
	if (view.status === 'failed' && job.state !== 'failed') return false;
	if (view.status === 'active' && !['queued', 'submitting', 'running'].includes(job.state))
		return false;
	if (
		view.status === 'attention' &&
		!['submission-unknown', 'authentication-required'].includes(job.state)
	)
		return false;
	return true;
}
export function canCompare(item: ReviewItem): boolean {
	return item.job.state === 'succeeded' && !!item.fileId;
}
