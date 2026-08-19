import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDatabase, verifyDatabase } from '../src/lib/server/database.js';
import {
  DEFAULT_MIGRATION_DIRECTORY,
  migrateDatabase,
} from '../src/lib/server/migrations.js';

test('creates a WAL database and applies migrations idempotently', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-db-'));
  const databasePath = path.join(temporaryDirectory, 'content.db');
  const database = openDatabase(databasePath);

  try {
    const first = migrateDatabase(database);
    const second = migrateDatabase(database);
    const tables = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);

    assert.deepEqual(first.applied, ['001_initial_content.sql']);
    assert.equal(first.currentVersion, 1);
    assert.deepEqual(second.applied, []);
    assert.equal(database.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.ok(tables.includes('posts'));
    assert.ok(tables.includes('media'));
    assert.ok(tables.includes('post_revisions'));
    assert.deepEqual(verifyDatabase(database), { integrity: 'ok', foreignKeyViolations: 0 });
  } finally {
    database.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('rejects changes to an already applied migration', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-migrations-'));
  const migrationDirectory = path.join(temporaryDirectory, 'migrations');
  fs.mkdirSync(migrationDirectory);
  fs.copyFileSync(
    path.join(DEFAULT_MIGRATION_DIRECTORY, '001_initial_content.sql'),
    path.join(migrationDirectory, '001_initial_content.sql'),
  );
  const database = openDatabase(':memory:');

  try {
    migrateDatabase(database, { migrationDirectory });
    fs.appendFileSync(path.join(migrationDirectory, '001_initial_content.sql'), '\n-- changed\n');
    assert.throws(
      () => migrateDatabase(database, { migrationDirectory }),
      /Applied migration changed/,
    );
  } finally {
    database.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
