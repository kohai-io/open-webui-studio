export interface Reference {
	id: string;
	name: string;
	role: 'identity' | 'wardrobe' | 'location' | 'prop' | 'style';
	description: string;
	fileId: string;
}
export interface FrameCrop {
	sourceFileId: string;
	ratio: '16:9' | '9:16' | '1:1';
	x: number;
	y: number;
	zoom: number;
}
export interface Shot {
	id: string;
	title: string;
	action: string;
	camera: string;
	setting: string;
	dialogue: string;
	sound: string;
	continuity: string;
	duration: number;
	referenceIds: string[];
	firstFrame: string;
	firstFrameCrop?: FrameCrop;
	lastFrame: string;
	framePrompt: string;
	videoPrompt: string;
	acceptedTakeId: string;
}
export interface ProjectDocument {
	name: string;
	format: string;
	brief: string;
	style: string;
	ratio: '16:9' | '9:16' | '1:1';
	language: string;
	modelId: string;
	videoModelId: string;
	references: Reference[];
	shots: Shot[];
}
export interface Project extends ProjectDocument {
	id: string;
	revision: number;
	archived: boolean;
	updatedAt: number;
}
export type JobKind =
	'storyboard' | 'revise' | 'first-frame' | 'last-frame' | 'reference' | 'video';
export type JobState =
	| 'queued'
	| 'submitting'
	| 'running'
	| 'succeeded'
	| 'failed'
	| 'cancelled'
	| 'submission-unknown'
	| 'authentication-required';
export interface JobInput {
	kind: JobKind;
	projectRevision: number;
	shotId: string;
	referenceId: string;
	instruction: string;
}
export interface Job {
	id: string;
	projectId: string;
	state: JobState;
	createdAt: number;
	updatedAt: number;
	input: JobInput;
	lastStatusAt?: number;
	/** Display number within this shot/reference and operation, across the full job history. */
	reviewNumber?: number;
	snapshot: ProjectDocument;
	prompt: string;
	instructionVersion: string;
	providerJobId?: string;
	providerTaskId?: string;
	failureCode?: string;
	fileIds?: string[];
	proposal?: Shot[];
	error?: string;
	note?: string;
}
export const terminal = (state: JobState) =>
	['succeeded', 'failed', 'cancelled', 'submission-unknown', 'authentication-required'].includes(
		state
	);
export function emptyShot(id: string): Shot {
	return {
		id,
		title: 'Untitled shot',
		action: '',
		camera: '',
		setting: '',
		dialogue: '',
		sound: '',
		continuity: '',
		duration: 5,
		referenceIds: [],
		firstFrame: '',
		lastFrame: '',
		framePrompt: '',
		videoPrompt: '',
		acceptedTakeId: ''
	};
}
export function emptyProject(name = 'Untitled project'): ProjectDocument {
	return {
		name,
		format: '',
		brief: '',
		style: '',
		ratio: '16:9',
		language: 'English',
		modelId: '',
		videoModelId: '',
		references: [],
		shots: []
	};
}
export function compilePrompt(
	project: ProjectDocument,
	shot: Shot,
	kind: 'image' | 'video'
): string {
	const references = project.references.filter((r) => shot.referenceIds.includes(r.id));
	return [
		kind === 'image' ? shot.framePrompt : shot.videoPrompt,
		`Subject and action: ${shot.action}`,
		`Setting and light: ${shot.setting}`,
		`Camera: ${shot.camera}`,
		`Visual treatment: ${project.style}`,
		...references.map(
			(r) =>
				`${kind === 'image' ? 'Reference guidance' : 'Continuity description'} for ${r.name}: ${r.role}; ${r.description}`
		),
		...(kind === 'video'
			? [
					`Dialogue (${project.language}), speaker and delivery: ${shot.dialogue || 'No dialogue'}`,
					`Sound: ${shot.sound || 'Natural ambience'}`,
					`Continuity: ${shot.continuity}`,
					'One continuous shot. Preserve the identities and wardrobe established in the first frame when supplied.'
				]
			: ['Create one production frame, with no panel grid or written labels.'])
	]
		.filter(Boolean)
		.join('\n');
}
