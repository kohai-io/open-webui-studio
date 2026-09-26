import { compilePrompt, type Job, type ProjectDocument, type Shot } from './types';

export function isTakeStale(job: Job, project: ProjectDocument): boolean {
	const kind = job.input.kind;
	if (!['video', 'first-frame', 'last-frame'].includes(kind)) return false;
	const old = job.snapshot.shots.find((s) => s.id === job.input.shotId);
	const current = project.shots.find((s) => s.id === job.input.shotId);
	if (!old || !current) return false;
	const promptKind = kind === 'video' ? 'video' : 'image';
	if (
		job.snapshot.ratio !== project.ratio ||
		compilePrompt(job.snapshot, old, promptKind) !== compilePrompt(project, current, promptKind)
	)
		return true;
	if (kind === 'video')
		return (
			old.firstFrame !== current.firstFrame ||
			old.lastFrame !== current.lastFrame ||
			old.duration !== current.duration
		);

	// Assigning this take's output is acceptance, not a change to its input frame.
	const adjusted = { ...current };
	const outputField = kind === 'last-frame' ? 'lastFrame' : 'firstFrame';
	if (job.fileIds?.includes(adjusted[outputField])) adjusted[outputField] = old[outputField];
	const frame = (shot: Shot) =>
		kind === 'last-frame' ? shot.lastFrame || shot.firstFrame : shot.firstFrame;
	const references = (doc: ProjectDocument, shot: Shot) =>
		doc.references.filter((r) => shot.referenceIds.includes(r.id)).map((r) => [r.id, r.fileId]);
	return (
		frame(old) !== frame(adjusted) ||
		JSON.stringify(references(job.snapshot, old)) !== JSON.stringify(references(project, current))
	);
}
