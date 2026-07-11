import { describe, expect, it } from 'vitest';
import { normaliseRequestId } from './request-id';

describe('request correlation contract', () => {
	it('retains an allowlisted request ID', () => {
		expect(normaliseRequestId('studio-test_123.trace')).toBe('studio-test_123.trace');
	});

	it('replaces an unsafe request ID', () => {
		expect(normaliseRequestId('contains spaces')).toMatch(/^[0-9a-f-]{36}$/);
	});
});
