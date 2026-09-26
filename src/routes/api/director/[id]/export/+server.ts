import { Readable } from 'node:stream';
import type { RequestHandler } from './$types';
import { requireDirector, directorError } from '$lib/server/director/http';
import { getServices } from '$lib/server/services';
import { bytes, exportManifest, zip, type ZipEntry } from '$lib/server/director/export';
import { DirectorError } from '$lib/director/validation';
export const GET: RequestHandler = async ({ locals, params, request }) => {
	try {
		const session = requireDirector(locals);
		const services = getServices();
		const project = services.director.get(session.owuiUserId, params.id);
		const jobs = services.director.jobs(session.owuiUserId, params.id);
		const manifest = exportManifest(project, jobs);
		const client = services.owuiForToken(session.owuiToken);
		let size = 0;
		for (const item of manifest.sequence)
			if (item.take) {
				const media = await client.getOwnedMedia(
					item.take.fileIds![0],
					session.owuiUserId,
					request.signal
				);
				if (media.mediaType !== 'video') throw new DirectorError('invalid_asset');
				size += media.size ?? 0;
			}
		if (size > 512 * 1024 * 1024) throw new DirectorError('export_too_large');
		async function* entries(): AsyncGenerator<ZipEntry> {
			yield { name: 'manifest.json', chunks: bytes(JSON.stringify(manifest, null, 2)) };
			yield {
				name: 'shot-list.txt',
				chunks: bytes(
					`${project.name}\n\n${manifest.sequence.map((s) => `${s.order}. ${s.title} — ${s.plannedDuration}s — ${s.filename ?? 'MISSING TAKE'}`).join('\n')}\n\nClips retain their generated audio. Planned durations are not measured output durations. Finish timing and sound in your editor.`
				)
			};
			for (const item of manifest.sequence)
				if (item.take && item.filename) {
					const response = await client.openMediaContent(
						item.take.fileIds![0],
						session.owuiUserId,
						'download',
						undefined,
						request.signal
					);
					if (!response.ok || !response.body) throw new Error('Media unavailable');
					yield { name: item.filename, chunks: Readable.fromWeb(response.body as never) };
				}
		}
		return new Response(Readable.toWeb(Readable.from(zip(entries()))) as ReadableStream, {
			headers: {
				'content-type': 'application/zip',
				'content-disposition': 'attachment; filename="director-production.zip"',
				'cache-control': 'private, no-store'
			}
		});
	} catch (e) {
		return directorError(e, locals.requestId);
	}
};
