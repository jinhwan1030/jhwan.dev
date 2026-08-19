import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  backupContentDatabase,
  invalidateAdminSessions,
  verifyContentBackup,
} from '../scripts/lib/content-backup.mjs';
import { openDatabase } from '../src/lib/server/database.js';
import { migrateDatabase } from '../src/lib/server/migrations.js';
import { createPostRepository } from '../src/lib/server/post-repository.js';

test('creates and verifies an online SQLite and media backup without overwriting', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-content-backup-'));
  const sourcePath = path.join(root, 'live/jhwan.db');
  const backupPath = path.join(root, 'backup/jhwan.db');
  const mediaRoot = path.join(root, 'backup/uploads');
  fs.mkdirSync(mediaRoot, { recursive: true });
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const mediaContents = Buffer.from('content-addressed media fixture');
  const mediaId = createHash('sha256').update(mediaContents).digest('hex');
  const storageKey = `${mediaId}.webp`;
  fs.writeFileSync(path.join(mediaRoot, storageKey), mediaContents);

  const database = openDatabase(sourcePath);
  try {
    migrateDatabase(database);
    createPostRepository(database, { idGenerator: () => 'post-1' }).create({
      slug: 'backup-post',
      title: '백업 글',
      description: '백업 테스트',
      bodyMarkdown: '본문',
      category: '개발',
      status: 'published',
      heroImagePath: null,
      publishedAt: '2026-08-19T00:00:00.000Z',
    });
    database.prepare(`
      INSERT INTO media (
        id, storage_key, original_name, mime_type, byte_size, width, height,
        alt_text, created_at, updated_at
      ) VALUES (?, ?, ?, 'image/webp', ?, 1, 1, '', ?, ?)
    `).run(
      mediaId,
      storageKey,
      'fixture.webp',
      mediaContents.length,
      '2026-08-19T00:00:00.000Z',
      '2026-08-19T00:00:00.000Z',
    );
  } finally {
    database.close();
  }

  const backup = await backupContentDatabase({ source: sourcePath, destination: backupPath });
  assert.ok(backup.pages > 0);
  assert.ok(backup.bytes > 0);
  assert.match(backup.checksum, /^[a-f0-9]{64}$/);
  assert.equal(backup.counts.posts, 1);
  assert.equal(backup.counts.media, 1);
  assert.equal(fs.existsSync(`${backupPath}-wal`), false);
  assert.equal(fs.existsSync(`${backupPath}-shm`), false);

  const portable = openDatabase(backupPath, { readOnly: true });
  try {
    assert.equal(portable.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
  } finally {
    portable.close();
  }

  const verification = verifyContentBackup({ databasePath: backupPath, mediaRoot });
  assert.deepEqual(verification.verification, { integrity: 'ok', foreignKeyViolations: 0 });
  assert.equal(verification.counts.posts, 1);
  assert.deepEqual(verification.media, { files: 1, referenced: 1, orphanFiles: [] });

  await assert.rejects(
    () => backupContentDatabase({ source: sourcePath, destination: backupPath }),
    /Refusing to overwrite/,
  );

  fs.writeFileSync(path.join(mediaRoot, storageKey), 'corrupted');
  assert.throws(
    () => verifyContentBackup({ databasePath: backupPath, mediaRoot }),
    /size mismatch|checksum mismatch/,
  );
});

test('invalidates every active administrator session after a restore', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-session-restore-'));
  const databasePath = path.join(root, 'jhwan.db');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const database = openDatabase(databasePath);
  migrateDatabase(database);
  database.prepare(`
    INSERT INTO admin_sessions (
      id, token_hash, csrf_token_hash, login_ticket_id, github_user_id,
      github_login, created_at, expires_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'active', 'a'.repeat(64), 'b'.repeat(64), 'ticket-active', '1', 'admin',
    '2026-08-19T00:00:00.000Z', '2099-08-19T00:00:00.000Z', null,
  );
  database.prepare(`
    INSERT INTO admin_sessions (
      id, token_hash, csrf_token_hash, login_ticket_id, github_user_id,
      github_login, created_at, expires_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'revoked', 'c'.repeat(64), 'd'.repeat(64), 'ticket-revoked', '1', 'admin',
    '2026-08-19T00:00:00.000Z', '2099-08-19T00:00:00.000Z', '2026-08-19T01:00:00.000Z',
  );
  database.close();

  const result = invalidateAdminSessions({
    databasePath,
    clock: () => Date.parse('2026-08-20T00:00:00.000Z'),
  });
  assert.deepEqual(result, {
    revokedSessions: 1,
    revokedAt: '2026-08-20T00:00:00.000Z',
  });

  const verified = openDatabase(databasePath, { readOnly: true });
  try {
    assert.equal(
      verified.prepare('SELECT revoked_at FROM admin_sessions WHERE id = ?').get('active').revoked_at,
      '2026-08-20T00:00:00.000Z',
    );
    assert.equal(
      verified.prepare('SELECT revoked_at FROM admin_sessions WHERE id = ?').get('revoked').revoked_at,
      '2026-08-19T01:00:00.000Z',
    );
  } finally {
    verified.close();
  }
});

test('reports valid orphaned content-addressed files without treating them as referenced', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-content-orphan-'));
  const databasePath = path.join(root, 'jhwan.db');
  const mediaRoot = path.join(root, 'uploads');
  fs.mkdirSync(mediaRoot);
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const database = openDatabase(databasePath);
  migrateDatabase(database);
  database.close();

  const contents = Buffer.from('orphan');
  const checksum = createHash('sha256').update(contents).digest('hex');
  const storageKey = `${checksum}.png`;
  fs.writeFileSync(path.join(mediaRoot, storageKey), contents);

  const verification = verifyContentBackup({ databasePath, mediaRoot });
  assert.deepEqual(verification.media, {
    files: 1,
    referenced: 0,
    orphanFiles: [storageKey],
  });
});
