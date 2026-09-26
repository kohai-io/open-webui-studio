import type { OwuiClient } from '$lib/server/owui/client';
import { OwuiError } from '$lib/server/owui/errors';
import { DirectorError, identifier, proposalFromText } from '$lib/director/validation';
import type { DirectorStore } from './store';
import { videoDiagnostics } from '$lib/director/video';
export type DirectorClient = Pick<
	OwuiClient,
	'completeText' | 'createImages' | 'resolveImages' | 'directorVideo' | 'getOwnedMedia'
>;
export class DirectorWorker {
	private stopped = true;
	private timer?: ReturnType<typeof setTimeout>;
	constructor(
		private store: DirectorStore,
		private clientForToken: (token: string) => DirectorClient
	) {}
	start() {
		if (!this.stopped) return;
		this.stopped = false;
		this.schedule();
	}
	stop() {
		this.stopped = true;
		clearTimeout(this.timer);
	}
	private schedule() {
		if (this.stopped) return;
		this.timer = setTimeout(async () => {
			try {
				await this.runOnce();
			} catch {
				/* next tick recovers expired claims */
			} finally {
				this.schedule();
			}
		}, 1000);
		this.timer.unref?.();
	}
	async runOnce() {
		const claim = this.store.claim();
		if (!claim) return false;
		const { job, ownerId, token, claimToken } = claim;
		const client = this.clientForToken(token);
		const pulse = setInterval(() => this.store.heartbeat(job.id, claimToken), 10_000);
		try {
			if (job.state === 'queued') {
				const shot = job.snapshot.shots.find((s) => s.id === job.input.shotId);
				let imageIds: string[] = [];
				if (job.input.kind === 'video') {
					const cap = await client.directorVideo(job.snapshot.videoModelId, {
						operation: 'capabilities'
					});
					if (cap.protocol !== 1 || cap.enabled !== true)
						throw new DirectorError('video_setup_required');
					if (shot!.lastFrame) throw new DirectorError('last_frame_not_supported');
					if (shot!.duration < 4 || shot!.duration > 30)
						throw new DirectorError('video_duration_4_to_30');
					if (shot!.firstFrame) await client.resolveImages([shot!.firstFrame], ownerId);
				} else if (!['storyboard', 'revise'].includes(job.input.kind)) {
					if (job.input.kind === 'reference') {
						const ref = job.snapshot.references.find((r) => r.id === job.input.referenceId)!;
						imageIds = ref.fileId ? [ref.fileId] : [];
					} else {
						imageIds = job.snapshot.references
							.filter((r) => shot!.referenceIds.includes(r.id))
							.map((r) => r.fileId);
						if (imageIds.some((id) => !id)) throw new DirectorError('reference_image_required');
						const frame =
							job.input.kind === 'last-frame'
								? shot!.lastFrame || shot!.firstFrame
								: shot!.firstFrame;
						if (frame) imageIds.unshift(frame);
						imageIds = [...new Set(imageIds)];
					}
					if (imageIds.length) {
						await client.resolveImages(imageIds, ownerId);
						job.prompt +=
							'\nInput image roles (in submission order):\n' +
							imageIds
								.map(
									(id, i) =>
										`Image ${i + 1}: ${[...(shot?.firstFrame === id ? ['existing first frame; preserve its subject identity'] : []), ...(shot?.lastFrame === id ? ['existing last frame'] : []), ...job.snapshot.references.filter((r) => r.fileId === id).map((r) => `${r.name}, ${r.role}`)].join('; ')}`
								)
								.join('\n');
					}
				}
				job.state = 'submitting';
				this.store.checkpoint(job, claimToken);
				if (job.input.kind === 'storyboard' || job.input.kind === 'revise') {
					const result = await client.completeText({
						modelId: job.snapshot.modelId,
						prompt: job.prompt
					});
					job.proposal = proposalFromText(
						result.content,
						job.snapshot,
						job.input.kind === 'revise' ? job.input.shotId : ''
					);
					job.state = 'succeeded';
				} else if (job.input.kind === 'video') {
					const result = await client.directorVideo(job.snapshot.videoModelId, {
						operation: 'submit',
						jobId: job.id,
						confirmed: true,
						prompt: job.prompt,
						firstFrameFileId: shot!.firstFrame,
						duration: shot!.duration,
						ratio: job.snapshot.ratio
					});
					if (
						result.jobId !== job.id ||
						!['running', 'submission-unknown', 'succeeded'].includes(String(result.state))
					)
						throw new DirectorError('invalid_video_response');
					job.providerJobId = job.id;
					job.providerTaskId = videoDiagnostics(result).providerTaskId;
					job.state = result.state === 'submission-unknown' ? 'submission-unknown' : 'running';
				} else {
					const result = await client.createImages({
						operation: imageIds.length ? 'edit' : 'generate',
						prompt: job.prompt,
						fileIds: imageIds,
						ownerId,
						size:
							job.snapshot.ratio === '16:9'
								? '1536x1024'
								: job.snapshot.ratio === '9:16'
									? '1024x1536'
									: '1024x1024'
					});
					job.fileIds = result.fileIds;
					job.state = 'succeeded';
				}
			} else if (job.state === 'running' && job.providerJobId) {
				const result = await client.directorVideo(job.snapshot.videoModelId, {
					operation: 'status',
					jobId: job.providerJobId
				});
				if (
					result.jobId !== job.id ||
					!['running', 'succeeded', 'failed', 'cancelled', 'submission-unknown'].includes(
						String(result.state)
					)
				)
					throw new DirectorError('invalid_video_response');
				if (result.state === 'succeeded') {
					if (!Array.isArray(result.fileIds) || result.fileIds.length !== 1)
						throw new DirectorError('invalid_video_response');
					const fileId = identifier(result.fileIds[0]);
					const media = await client.getOwnedMedia(fileId, ownerId);
					if (media.mediaType !== 'video') throw new DirectorError('invalid_video_response');
					job.fileIds = [fileId];
				}
				job.state = result.state as typeof job.state;
				const diagnostics = videoDiagnostics(result);
				job.providerTaskId = diagnostics.providerTaskId ?? job.providerTaskId;
				job.failureCode = diagnostics.failureCode;
				job.error = undefined;
			}
		} catch (error) {
			if (job.state === 'running') {
				// Keep the known task. A failed status/import request must not rerender it.
				job.error = 'status_unavailable';
				if (error instanceof OwuiError && error.status === 401)
					job.state = 'authentication-required';
			} else {
				const rejected =
					(error instanceof DirectorError && error.code !== 'invalid_video_response') ||
					(error instanceof OwuiError && [400, 401, 403, 404, 422, 429].includes(error.status));
				job.state = job.state === 'submitting' && !rejected ? 'submission-unknown' : 'failed';
				job.error =
					error instanceof DirectorError
						? error.code
						: error instanceof OwuiError
							? error.code
							: 'generation_failed';
			}
		} finally {
			clearInterval(pulse);
			this.store.checkpoint(job, claimToken, true);
		}
		return true;
	}
}
