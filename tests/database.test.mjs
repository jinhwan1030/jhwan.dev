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

    assert.deepEqual(first.applied, [
      '001_initial_content.sql',
      '002_admin_api.sql',
      '003_retire_test_post.sql',
    ]);
    assert.equal(first.currentVersion, 3);
    assert.deepEqual(second.applied, []);
    assert.equal(database.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(database.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.ok(tables.includes('posts'));
    assert.ok(tables.includes('media'));
    assert.ok(tables.includes('post_revisions'));
    assert.ok(tables.includes('admin_sessions'));
    assert.ok(tables.includes('post_slug_history'));
    assert.deepEqual(verifyDatabase(database), { integrity: 'ok', foreignKeyViolations: 0 });
  } finally {
    database.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('retires the legacy writing-page test post with a recoverable revision', () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-retire-test-post-'));
  const migrationDirectory = path.join(temporaryDirectory, 'migrations');
  fs.mkdirSync(migrationDirectory);
  for (const filename of ['001_initial_content.sql', '002_admin_api.sql']) {
    fs.copyFileSync(
      path.join(DEFAULT_MIGRATION_DIRECTORY, filename),
      path.join(migrationDirectory, filename),
    );
  }
  const database = openDatabase(':memory:');

  try {
    migrateDatabase(database, { migrationDirectory });
    const timestamp = '2026-08-19T00:00:00.000Z';
    database.prepare(`
      INSERT INTO posts (
        id, slug, title, description, body_markdown, category, status,
        published_at, content_updated_at, created_at, updated_at, version,
        source_path, source_checksum
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'legacy-test-post',
      '게시글-작성페이지-테스트',
      '게시글 작성페이지 테스트',
      '테스트입니다.',
      '안녕하세요 게시글 작성 페이지 테스트입니다.',
      '개발',
      'published',
      timestamp,
      timestamp,
      timestamp,
      timestamp,
      1,
      'src/content/blog/게시글-작성페이지-테스트.md',
      'a'.repeat(64),
    );
    database.prepare(`
      INSERT INTO post_revisions (post_id, version, snapshot_json, created_at)
      VALUES (?, 1, ?, ?)
    `).run('legacy-test-post', JSON.stringify({ deletedAt: null }), timestamp);

    fs.copyFileSync(
      path.join(DEFAULT_MIGRATION_DIRECTORY, '003_retire_test_post.sql'),
      path.join(migrationDirectory, '003_retire_test_post.sql'),
    );
    const result = migrateDatabase(database, { migrationDirectory });
    const post = database
      .prepare('SELECT * FROM posts WHERE id = ?')
      .get('legacy-test-post');
    const revisions = database
      .prepare('SELECT version, snapshot_json FROM post_revisions WHERE post_id = ? ORDER BY version')
      .all('legacy-test-post');

    assert.deepEqual(result.applied, ['003_retire_test_post.sql']);
    assert.equal(result.currentVersion, 3);
    assert.ok(post.deleted_at);
    assert.equal(post.version, 2);
    assert.equal(post.source_path, null);
    assert.equal(post.source_checksum, null);
    assert.equal(revisions.length, 2);
    assert.ok(JSON.parse(revisions[1].snapshot_json).deletedAt);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM posts WHERE deleted_at IS NULL").get().count,
      0,
    );
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
