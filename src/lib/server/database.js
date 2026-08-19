import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const MINIMUM_NODE_VERSION = [24, 15, 0];

function assertSupportedNodeVersion(version = process.versions.node) {
  const current = version.split('.').map(Number);
  for (let index = 0; index < MINIMUM_NODE_VERSION.length; index += 1) {
    if (current[index] > MINIMUM_NODE_VERSION[index]) return;
    if (current[index] < MINIMUM_NODE_VERSION[index]) {
      throw new Error(
        `The content database requires Node.js ${MINIMUM_NODE_VERSION.join('.')} or newer; current version is ${version}`,
      );
    }
  }
}

export function resolveDatabasePath(databasePath = process.env.JHWAN_DATABASE_PATH) {
  const configuredPath = databasePath?.trim();
  if (!configuredPath) return path.resolve('.data/jhwan.db');
  if (configuredPath === ':memory:') return configuredPath;
  return path.resolve(configuredPath);
}

export function openDatabase(databasePath, { readOnly = false, enableWal = true } = {}) {
  assertSupportedNodeVersion();
  const resolvedPath = resolveDatabasePath(databasePath);

  if (resolvedPath !== ':memory:' && !readOnly) {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const database = new DatabaseSync(resolvedPath, {
    readOnly,
    timeout: 5_000,
    defensive: true,
  });

  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');

  if (!readOnly && enableWal) {
    database.exec('PRAGMA journal_mode = WAL');
    database.exec('PRAGMA synchronous = NORMAL');
  }

  return database;
}

export function withImmediateTransaction(database, callback) {
  if (database.isTransaction) throw new Error('Nested database transactions are not supported');

  database.exec('BEGIN IMMEDIATE');
  try {
    const result = callback();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK');
    throw error;
  }
}

export function verifyDatabase(database) {
  const integrityRows = database.prepare('PRAGMA integrity_check').all();
  const integrityMessages = integrityRows.map((row) => row.integrity_check);
  if (integrityMessages.length !== 1 || integrityMessages[0] !== 'ok') {
    throw new Error(`SQLite integrity check failed: ${integrityMessages.join(', ')}`);
  }

  const foreignKeyViolations = database.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeyViolations.length > 0) {
    throw new Error(`SQLite foreign key check failed with ${foreignKeyViolations.length} violation(s)`);
  }

  return { integrity: 'ok', foreignKeyViolations: 0 };
}
