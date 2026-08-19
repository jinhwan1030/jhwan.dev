import path from 'node:path';

import { loadMarkdownPosts } from '../../../scripts/lib/markdown-posts.mjs';
import { openDatabase, verifyDatabase } from './database.js';
import { migrateDatabase } from './migrations.js';
import { createPostRepository } from './post-repository.js';

const RUNTIME_SYMBOL = Symbol.for('jhwan.content-runtime');

function seedEmptyDatabase(database, repository, contentDirectory) {
  const count = database.prepare('SELECT COUNT(*) AS count FROM posts').get().count;
  if (count > 0) return { seeded: false, count };

  const posts = loadMarkdownPosts(contentDirectory);
  const imported = repository.importPosts(posts);
  return { seeded: true, count: posts.length, imported };
}

export function createContentRuntime({
  databasePath = process.env.JHWAN_DATABASE_PATH,
  contentDirectory = process.env.JHWAN_CONTENT_SEED_PATH ?? path.resolve('src/content/blog'),
} = {}) {
  const database = openDatabase(databasePath);
  try {
    const migration = migrateDatabase(database);
    const repository = createPostRepository(database);
    const seed = seedEmptyDatabase(database, repository, path.resolve(contentDirectory));
    const verification = verifyDatabase(database);
    return { database, repository, migration, seed, verification };
  } catch (error) {
    database.close();
    throw error;
  }
}

export function getContentRuntime() {
  if (!globalThis[RUNTIME_SYMBOL]) globalThis[RUNTIME_SYMBOL] = createContentRuntime();
  return globalThis[RUNTIME_SYMBOL];
}

export function closeContentRuntime() {
  const runtime = globalThis[RUNTIME_SYMBOL];
  if (!runtime) return;
  runtime.database.close();
  delete globalThis[RUNTIME_SYMBOL];
}
