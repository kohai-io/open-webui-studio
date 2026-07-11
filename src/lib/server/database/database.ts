import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

export type StudioDatabase = Database.Database;

export function openStudioDatabase(
	filename: string,
	migrationsDirectory = join(process.cwd(), 'migrations')
): StudioDatabase {
	if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
	const database = new Database(filename);
	database.pragma('journal_mode = WAL');
	database.pragma('foreign_keys = ON');
	database.exec(
		'CREATE TABLE IF NOT EXISTS studio_migration (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)'
	);

	const applied = database.prepare('SELECT 1 FROM studio_migration WHERE name = ?');
	const record = database.prepare('INSERT INTO studio_migration (name, applied_at) VALUES (?, ?)');
	const apply = database.transaction((name: string, sql: string) => {
		database.exec(sql);
		record.run(name, Date.now());
	});

	for (const name of readdirSync(migrationsDirectory)
		.filter((name) => name.endsWith('.sql'))
		.sort()) {
		if (!applied.get(name)) apply(name, readFileSync(join(migrationsDirectory, name), 'utf8'));
	}
	return database;
}
