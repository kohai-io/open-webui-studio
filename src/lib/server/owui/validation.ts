import { OwuiError } from './errors';
export type JsonObject = Record<string, unknown>;
export function object(value: unknown, requestId: string): JsonObject {
	if (typeof value !== 'object' || value === null || Array.isArray(value))
		throw new OwuiError('invalid_response', 502, requestId);
	return value as JsonObject;
}
export function string(value: unknown, requestId: string): string {
	if (typeof value !== 'string') throw new OwuiError('invalid_response', 502, requestId);
	return value;
}
export function number(value: unknown, requestId: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value))
		throw new OwuiError('invalid_response', 502, requestId);
	return value;
}
export const nullableString = (value: unknown, id: string) =>
	value == null ? null : string(value, id);
export const nullableNumber = (value: unknown, id: string) =>
	value == null ? null : number(value, id);
export function array(value: unknown, requestId: string): unknown[] {
	if (!Array.isArray(value)) throw new OwuiError('invalid_response', 502, requestId);
	return value;
}
