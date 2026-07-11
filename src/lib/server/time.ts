export function normaliseEpochMilliseconds(value: number | null): number | null {
	if (value === null) return null;
	return Math.abs(value) < 1_000_000_000_000 ? value * 1_000 : value;
}
