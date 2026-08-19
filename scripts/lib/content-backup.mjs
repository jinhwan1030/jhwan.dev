import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { backup as sqliteBackup } from 'node:sqlite';

import { openDatabase, verifyDatabase, withImmediateTransaction } from '../../src/lib/server/database.js';
import { MANAGED_MEDIA_KEY_PATTERN } from '../../src/lib/server/media-storage.js';

function assertRegularFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} does not exist: ${filePath}`);
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular file: ${filePath}`);
  }
  return stat;
}

function assertRealDirectory(directory, label) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} does not exist: ${directory}`);
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${directory}`);
  }
  return fs.realpathSync(directory);
}

function databaseCounts(database) {
  const count = (table, where = '') =>
    database.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get().count;
  return {
    posts: count('posts'),
    publishedPosts: count('posts', "WHERE status = 'published' AND deleted_at IS NULL"),
    draftPosts: count('posts', "WHERE status = 'draft' AND deleted_at IS NULL"),
    deletedPosts: count('posts', 'WHERE deleted_at IS NOT NULL'),
    media: count('media'),
    revisions: count('post_revisions'),
    adminSessions: count('admin_sessions'),
    schemaMigrations: count('schema_migrations'),
  };
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listMediaFiles(mediaRoot) {
  return fs.readdirSync(mediaRoot, { withFileTypes: true }).map((entry) => {
    if (entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`Backup media directory may contain regular files only: ${entry.name}`);
    }
    if (!MANAGED_MEDIA_KEY_PATTERN.test(entry.name)) {
      throw new Error(`Unmanaged file found in backup media directory: ${entry.name}`);
    }
    return entry.name;
  }).sort();
}

export async function backupContentDatabase({ source, destination }) {
  const sourcePath = path.resolve(source);
  const destinationPath = path.resolve(destination);
  assertRegularFile(sourcePath, 'Source database');
  if (fs.existsSync(destinationPath)) {
    throw new Error(`Refusing to overwrite an existing backup: ${destinationPath}`);
  }
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });

  const sourceDatabase = openDatabase(sourcePath, { readOnly: true });
  try {
    verifyDatabase(sourceDatabase);
    const pages = await sqliteBackup(sourceDatabase, destinationPath, { rate: 128 });
    const backupDatabase = openDatabase(destinationPath, { enableWal: false });
    let details;
    try {
      const journalMode = backupDatabase.prepare('PRAGMA journal_mode = DELETE').get().journal_mode;
      if (journalMode !== 'delete') {
        throw new Error(`Backup database journal mode is not portable: ${journalMode}`);
      }
      details = {
        verification: verifyDatabase(backupDatabase),
        counts: databaseCounts(backupDatabase),
      };
    } finally {
      backupDatabase.close();
    }
    const destinationStat = assertRegularFile(destinationPath, 'Backup database');
    return {
      pages,
      bytes: destinationStat.size,
      checksum: sha256File(destinationPath),
      ...details,
    };
  } catch (error) {
    fs.rmSync(destinationPath, { force: true });
    throw error;
  } finally {
    sourceDatabase.close();
  }
}

export function verifyContentBackup({ databasePath, mediaRoot }) {
  const resolvedDatabase = path.resolve(databasePath);
  const resolvedMediaRoot = path.resolve(mediaRoot);
  const databaseStat = assertRegularFile(resolvedDatabase, 'Backup database');
  const mediaRealRoot = assertRealDirectory(resolvedMediaRoot, 'Backup media directory');
  const database = openDatabase(resolvedDatabase, { readOnly: true });
  try {
    const verification = verifyDatabase(database);
    const mediaRows = database
      .prepare('SELECT id, storage_key, byte_size FROM media ORDER BY storage_key')
      .all();
    const databaseKeys = new Set();
    for (const row of mediaRows) {
      if (!MANAGED_MEDIA_KEY_PATTERN.test(row.storage_key) || row.id !== row.storage_key.slice(0, 64)) {
        throw new Error(`Invalid content-addressed media record: ${row.storage_key}`);
      }
      const mediaPath = path.join(resolvedMediaRoot, row.storage_key);
      const mediaStat = assertRegularFile(mediaPath, 'Referenced backup media');
      const mediaRealPath = fs.realpathSync(mediaPath);
      if (!mediaRealPath.startsWith(`${mediaRealRoot}${path.sep}`)) {
        throw new Error(`Backup media escapes its root: ${row.storage_key}`);
      }
      if (mediaStat.size !== row.byte_size) {
        throw new Error(`Backup media size mismatch: ${row.storage_key}`);
      }
      if (sha256File(mediaPath) !== row.id) {
        throw new Error(`Backup media checksum mismatch: ${row.storage_key}`);
      }
      databaseKeys.add(row.storage_key);
    }

    const files = listMediaFiles(resolvedMediaRoot);
    const orphanFiles = files.filter((storageKey) => !databaseKeys.has(storageKey));
    return {
      databaseBytes: databaseStat.size,
      databaseChecksum: sha256File(resolvedDatabase),
      verification,
      counts: databaseCounts(database),
      media: {
        files: files.length,
        referenced: databaseKeys.size,
        orphanFiles,
      },
    };
  } finally {
    database.close();
  }
}

export function invalidateAdminSessions({ databasePath, clock = () => Date.now() }) {
  const resolvedDatabase = path.resolve(databasePath);
  assertRegularFile(resolvedDatabase, 'Restored database');
  const database = openDatabase(resolvedDatabase);
  try {
    const revokedAt = new Date(clock()).toISOString();
    const result = withImmediateTransaction(database, () =>
      database
        .prepare('UPDATE admin_sessions SET revoked_at = ? WHERE revoked_at IS NULL')
        .run(revokedAt),
    );
    verifyDatabase(database);
    return { revokedSessions: Number(result.changes), revokedAt };
  } finally {
    database.close();
  }
}
