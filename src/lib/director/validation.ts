import { emptyShot, type ProjectDocument, type Shot, type Reference } from './types';
export class DirectorError extends Error {
	constructor(
		public code: string,
		public status = 400
	) {
		super(code);
	}
}
export function record(v: unknown): Record<string, unknown> {
	if (!v || typeof v !== 'object' || Array.isArray(v)) throw new DirectorError('validation_failed');
	return v as Record<string, unknown>;
}
export function text(v: unknown, max = 16000): string {
	if (typeof v !== 'string' || v.length > max) throw new DirectorError('validation_failed');
	return v;
}
export function identifier(v: unknown, optional = false): string {
	const s = text(v, 128);
	if (!(optional && s === '') && !/^[a-zA-Z0-9_-]+$/.test(s))
		throw new DirectorError('invalid_identifier');
	return s;
}
function list(v: unknown, max: number): unknown[] {
	if (!Array.isArray(v) || v.length > max) throw new DirectorError('validation_failed');
	return v;
}
function unique(ids: string[]) {
	if (new Set(ids).size !== ids.length) throw new DirectorError('duplicate_identifier');
}
export function validateShot(value: unknown): Shot {
	const v = record(value);
	const shot = emptyShot(identifier(v.id));
	for (const key of [
		'title',
		'action',
		'camera',
		'setting',
		'dialogue',
		'sound',
		'continuity',
		'framePrompt',
		'videoPrompt'
	] as const)
		shot[key] = text(v[key]);
	for (const key of ['firstFrame', 'lastFrame', 'acceptedTakeId'] as const)
		shot[key] = identifier(v[key], true);
	if (v.firstFrameCrop !== undefined) {
		const crop = record(v.firstFrameCrop);
		if (
			!shot.firstFrame ||
			!['16:9', '9:16', '1:1'].includes(String(crop.ratio)) ||
			['x', 'y', 'zoom'].some(
				(key) => typeof crop[key] !== 'number' || !Number.isFinite(crop[key])
			) ||
			Number(crop.x) < 0 ||
			Number(crop.x) > 100 ||
			Number(crop.y) < 0 ||
			Number(crop.y) > 100 ||
			Number(crop.zoom) < 1 ||
			Number(crop.zoom) > 3
		)
			throw new DirectorError('invalid_frame_crop');
		shot.firstFrameCrop = {
			sourceFileId: identifier(crop.sourceFileId),
			ratio: crop.ratio as '16:9' | '9:16' | '1:1',
			x: Number(crop.x),
			y: Number(crop.y),
			zoom: Number(crop.zoom)
		};
	}
	if (
		typeof v.duration !== 'number' ||
		!Number.isInteger(v.duration) ||
		v.duration < 1 ||
		v.duration > 120
	)
		throw new DirectorError('invalid_duration');
	shot.duration = v.duration;
	shot.referenceIds = list(v.referenceIds, 8).map((id) => identifier(id));
	unique(shot.referenceIds);
	return shot;
}
export function validateDocument(value: unknown): ProjectDocument {
	const v = record(value);
	const ratio = text(v.ratio);
	if (!['16:9', '9:16', '1:1'].includes(ratio)) throw new DirectorError('invalid_ratio');
	const references: Reference[] = list(v.references, 100).map((item) => {
		const r = record(item);
		if (!['identity', 'wardrobe', 'location', 'prop', 'style'].includes(String(r.role)))
			throw new DirectorError('invalid_reference_role');
		return {
			id: identifier(r.id),
			name: text(r.name, 200),
			role: r.role as Reference['role'],
			description: text(r.description),
			fileId: identifier(r.fileId, true)
		};
	});
	const shots = list(v.shots, 100).map(validateShot);
	unique(references.map((r) => r.id));
	unique(shots.map((s) => s.id));
	if (shots.some((s) => s.referenceIds.some((id) => !references.some((r) => r.id === id))))
		throw new DirectorError('missing_reference');
	const name = text(v.name, 200).trim();
	if (!name) throw new DirectorError('name_required');
	return {
		name,
		format: text(v.format, 100),
		brief: text(v.brief),
		style: text(v.style),
		ratio: ratio as ProjectDocument['ratio'],
		language: text(v.language, 100),
		modelId: text(v.modelId, 256),
		videoModelId: text(v.videoModelId, 256),
		references,
		shots
	};
}
export function proposalFromText(
	content: string,
	snapshot: ProjectDocument,
	targetId = ''
): Shot[] {
	let result: unknown;
	try {
		result = JSON.parse(
			content
				.trim()
				.replace(/^```(?:json)?\s*/i, '')
				.replace(/\s*```$/, '')
		);
	} catch {
		throw new DirectorError('invalid_director_response');
	}
	const items = list(record(result).shots, 30);
	if (!items.length) throw new DirectorError('invalid_director_response');
	if (targetId && items.length !== 1) throw new DirectorError('invalid_director_response');
	return items.map((item, i) => {
		const v = record(item);
		const original = snapshot.shots.find((s) => s.id === targetId);
		const shot = { ...(original ?? emptyShot(`proposal-${i}`)) };
		for (const key of [
			'title',
			'action',
			'camera',
			'setting',
			'dialogue',
			'sound',
			'continuity',
			'framePrompt',
			'videoPrompt'
		] as const)
			if (v[key] !== undefined) shot[key] = text(v[key]);
		if (v.duration !== undefined) shot.duration = v.duration as number;
		return validateShot(shot);
	});
}
