import type { FrameCrop } from './types';

/** One geometry for the visible preview and the PNG uploaded to OWUI. */
export function cropGeometry(
	width: number,
	height: number,
	crop: Pick<FrameCrop, 'ratio' | 'x' | 'y' | 'zoom'>
) {
	const [rw, rh] = crop.ratio.split(':').map(Number);
	const scale = Math.min(width / rw, height / rh) / crop.zoom;
	const sw = scale * rw,
		sh = scale * rh;
	const outputScale = Math.max(1, Math.floor(Math.min(scale, 1600 / Math.max(rw, rh))));
	return {
		sx: ((width - sw) * crop.x) / 100,
		sy: ((height - sh) * crop.y) / 100,
		sw,
		sh,
		width: outputScale * rw,
		height: outputScale * rh
	};
}
