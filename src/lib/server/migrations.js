import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withImmediateTransaction } from './database.js';

export const DEFAULT_MIGRATION_DIRECTORY = fileURLToPath(
  new URL('../../../database/migrations/', import.meta.url),
);

function checksum(source) {
  return createHash('sha256').update(source).digest('hex');
}

export function readMigrations(migrationDirectory = DEFAULT_MIGRATION_DIRECTORY) {
  const entries = fs
    .readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .sort((left, right) => left.name.localeCompare(right.name));

  const versions = new Set();
  return entries.map((entry) => {
    const match = entry.name.match(/^(\d{3})_([a-z0-9_]+)\.sql$/);
    if (!match) throw new Error(`Invalid migration filename: ${entry.name}`);

    const version = Number(match[1]);
    if (versions.has(version)) throw new Error(`Duplicate migration version: ${match[1]}`);
    versions.add(version);

    const source = fs.readFileSync(path.join(migrationDirectory, entry.name), 'utf8');
    return {
      version,
      name: match[2],
      filename: entry.name,
      source,
      checksum: checksum(source),
    };
  });
}

export function migrateDatabase(database, { migrationDirectory } = {}) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT
  `);

  const migrations = readMigrations(migrationDirectory);
  const appliedRows = database
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all();
  const appliedByVersion = new Map(appliedRows.map((migration) => [migration.version, migration]));
  const availableVersions = new Set(migrations.map((migration) => migration.version));

  for (const applied of appliedRows) {
    if (!availableVersions.has(applied.version)) {
      throw new Error(`Applied migration ${applied.version} (${applied.name}) is missing from the repository`);
    }
  }

  const insertMigration = database.prepare(
    'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
  );
  const applied = [];

  for (const migration of migrations) {
    const existing = appliedByVersion.get(migration.version);
    if (existing) {
      if (existing.name !== migration.name || existing.checksum !== migration.checksum) {
        throw new Error(`Applied migration changed: ${migration.filename}`);
      }
      continue;
    }

    withImmediateTransaction(database, () => {
      database.exec(migration.source);
      insertMigration.run(
        migration.version,
        migration.name,
        migration.checksum,
        new Date().toISOString(),
      );
    });
    applied.push(migration.filename);
  }

  return { applied, currentVersion: migrations.at(-1)?.version ?? 0 };
}
