import type { RequestHandler } from './$types';
import { getServices } from '$lib/server/services';
import { requireDirector, directorError } from '$lib/server/director/http';
import { assertSameOrigin, flowJson, readFlowBody } from '$lib/server/flows/http';
import {
	DirectorError,
	identifier,
	record,
	text,
	validateDocument
} from '$lib/director/validation';
import type { JobInput } from '$lib/director/types';
export const GET: RequestHandler = ({ locals, params }) => {
	try {
		const s = requireDirector(locals);
		const store = getServices().director;
		return flowJson(
			{ project: store.get(s.owuiUserId, params.id), jobs: store.jobs(s.owuiUserId, params.id) },
			locals.requestId
		);
	} catch (e) {
		return directorError(e, locals.requestId);
	}
};
export const POST: RequestHandler = async ({ locals, params, request, url }) => {
	try {
		const s = requireDirector(locals);
		assertSameOrigin(request, url);
		const services = getServices();
		const store = services.director;
		store.get(s.owuiUserId, params.id);
		const client = services.owuiForToken(s.owuiToken);
		const body = await readFlowBody(request, [
			'operation',
			'revision',
			'document',
			'archived',
			'input',
			'jobId',
			'fileId',
			'note'
		]);
		const revision = Number(body.revision);
		const expires = Math.min(s.expiresAt, s.owuiTokenExpiresAt ?? s.expiresAt);
		if (body.operation === 'save') {
			const doc = validateDocument(body.document);
			const ids = [
				...new Set(
					[
						...doc.references.map((r) => r.fileId),
						...doc.shots.flatMap((shot) => [shot.firstFrame, shot.lastFrame])
					].filter(Boolean)
				)
			];
			for (const id of ids) await client.resolveImages([id], s.owuiUserId);
			if (body.archived !== undefined && typeof body.archived !== 'boolean')
				throw new DirectorError('validation_failed');
			return flowJson(
				store.save(s.owuiUserId, params.id, revision, doc, body.archived as boolean | undefined),
				locals.requestId
			);
		}
		if (body.operation === 'undo')
			return flowJson(store.undo(s.owuiUserId, params.id, revision), locals.requestId);
		if (body.operation === 'queue') {
			const v = record(body.input);
			const input: JobInput = {
				kind: text(v.kind) as JobInput['kind'],
				projectRevision: revision,
				shotId: identifier(v.shotId ?? '', true),
				referenceId: identifier(v.referenceId ?? '', true),
				instruction: text(v.instruction ?? '', 8000)
			};
			return flowJson(
				store.queue(
					s.owuiUserId,
					params.id,
					input,
					request.headers.get('idempotency-key') ?? '',
					s.owuiToken,
					expires
				),
				locals.requestId,
				202
			);
		}
		if (body.operation === 'capabilities') {
			const project = store.get(s.owuiUserId, params.id);
			return flowJson(
				await client.directorVideo(project.videoModelId, { operation: 'capabilities' }),
				locals.requestId
			);
		}
		const jobId = identifier(body.jobId);
		if (body.operation === 'review') {
			store.review(s.owuiUserId, params.id, jobId, body.note);
			return flowJson({ ok: true }, locals.requestId);
		}
		if (body.operation === 'apply') {
			const job = store.getJob(s.owuiUserId, params.id, jobId);
			const fileId = body.fileId === undefined ? undefined : identifier(body.fileId);
			if (fileId) {
				const media = await client.getOwnedMedia(fileId, s.owuiUserId);
				if (media.mediaType !== (job.input.kind === 'video' ? 'video' : 'image'))
					throw new DirectorError('invalid_asset');
			}
			return flowJson(
				store.apply(s.owuiUserId, params.id, jobId, revision, fileId),
				locals.requestId
			);
		}
		if (body.operation === 'cancel') {
			store.cancel(s.owuiUserId, params.id, jobId);
			return flowJson({ ok: true }, locals.requestId);
		}
		if (body.operation === 'resume') {
			store.resume(s.owuiUserId, params.id, jobId, s.owuiToken, expires);
			return flowJson({ ok: true }, locals.requestId);
		}
		throw new DirectorError('invalid_operation');
	} catch (e) {
		return directorError(e, locals.requestId);
	}
};
