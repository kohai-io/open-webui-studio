import type { Job, Project } from '$lib/director/types';
export interface ZipEntry {
	name: string;
	chunks: AsyncIterable<Uint8Array>;
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
	for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
	return n >>> 0;
});
export async function* zip(entries: AsyncIterable<ZipEntry>): AsyncGenerator<Uint8Array> {
	let offset = 0;
	let total = 0;
	const central: Buffer[] = [];
	for await (const entry of entries) {
		const name = Buffer.from(entry.name);
		const start = offset;
		const header = Buffer.alloc(30);
		header.writeUInt32LE(0x04034b50);
		header.writeUInt16LE(20, 4);
		header.writeUInt16LE(0x808, 6);
		header.writeUInt16LE(33, 12);
		header.writeUInt16LE(name.length, 26);
		yield header;
		yield name;
		offset += header.length + name.length;
		let crc = 0xffffffff;
		let size = 0;
		for await (const bytes of entry.chunks) {
			size += bytes.length;
			total += bytes.length;
			if (total > 512 * 1024 * 1024) throw new Error('Export exceeds 512 MB');
			for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
			yield bytes;
			offset += bytes.length;
		}
		crc = (crc ^ 0xffffffff) >>> 0;
		const descriptor = Buffer.alloc(16);
		descriptor.writeUInt32LE(0x08074b50);
		descriptor.writeUInt32LE(crc, 4);
		descriptor.writeUInt32LE(size, 8);
		descriptor.writeUInt32LE(size, 12);
		yield descriptor;
		offset += 16;
		const directory = Buffer.alloc(46);
		directory.writeUInt32LE(0x02014b50);
		directory.writeUInt16LE(20, 4);
		directory.writeUInt16LE(20, 6);
		directory.writeUInt16LE(0x808, 8);
		directory.writeUInt16LE(33, 14);
		directory.writeUInt32LE(crc, 16);
		directory.writeUInt32LE(size, 20);
		directory.writeUInt32LE(size, 24);
		directory.writeUInt16LE(name.length, 28);
		directory.writeUInt32LE(start, 42);
		central.push(Buffer.concat([directory, name]));
	}
	const centralOffset = offset;
	for (const part of central) {
		yield part;
		offset += part.length;
	}
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50);
	end.writeUInt16LE(central.length, 8);
	end.writeUInt16LE(central.length, 10);
	end.writeUInt32LE(offset - centralOffset, 12);
	end.writeUInt32LE(centralOffset, 16);
	yield end;
}
export async function* bytes(value: string) {
	yield Buffer.from(value);
}
export function exportManifest(project: Project, jobs: Job[]) {
	return {
		schemaVersion: 1,
		project,
		sequence: project.shots.map((shot, i) => {
			const take = jobs.find(
				(job) => job.id === shot.acceptedTakeId && job.state === 'succeeded' && job.fileIds?.length
			);
			return {
				order: i + 1,
				shotId: shot.id,
				title: shot.title,
				plannedDuration: shot.duration,
				missing: !take,
				filename: take ? `shots/${String(i + 1).padStart(3, '0')}.mp4` : null,
				take: take ?? null
			};
		})
	};
}
