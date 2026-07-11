import { randomUUID } from 'node:crypto';

const requestIdPattern = /^[A-Za-z0-9._-]{1,128}$/;

export function normaliseRequestId(value: string | null): string {
	return value && requestIdPattern.test(value) ? value : randomUUID();
}
