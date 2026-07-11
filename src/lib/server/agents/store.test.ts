import { describe, expect, it } from 'vitest';
import { openStudioDatabase } from '$lib/server/database/database';
import { AgentStore } from './store';

describe('AgentStore', () => {
	it('keeps personal agents isolated by OWUI user', () => {
		const database = openStudioDatabase(':memory:');
		const store = new AgentStore(database, () => 100);
		const created = store.create('user-a', {
			name: 'Researcher',
			description: 'Finds evidence',
			modelId: 'model-a'
		});

		expect(store.list('user-a')).toEqual([created]);
		expect(store.list('user-b')).toEqual([]);
		expect(store.get('user-b', created.id)).toBeNull();
		expect(store.delete('user-b', created.id)).toBe(false);
		expect(store.delete('user-a', created.id)).toBe(true);
	});
});
