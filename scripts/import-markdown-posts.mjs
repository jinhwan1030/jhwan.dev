import path from 'node:path';
import { parseArgs } from 'node:util';
import { openDatabase, verifyDatabase } from '../src/lib/server/database.js';
import { migrateDatabase } from '../src/lib/server/migrations.js';
import { createPostRepository } from '../src/lib/server/post-repository.js';
import { loadMarkdownPosts, summarizeMarkdownPosts } from './lib/markdown-posts.mjs';

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    content: { type: 'string', default: 'src/content/blog' },
    database: { type: 'string' },
  },
});

const posts = loadMarkdownPosts(path.resolve(values.content));
const content = summarizeMarkdownPosts(posts);

if (!values.apply) {
  console.log(JSON.stringify({ mode: 'dry-run', content }, null, 2));
  process.exit(0);
}

const databasePath = values.database ?? process.env.JHWAN_DATABASE_PATH;
if (!databasePath) {
  throw new Error('Refusing to import implicitly. Use --apply with --database <path> or JHWAN_DATABASE_PATH.');
}

const database = openDatabase(databasePath);
try {
  const migration = migrateDatabase(database);
  const imported = createPostRepository(database).importPosts(posts);
  const verification = verifyDatabase(database);
  console.log(
    JSON.stringify(
      { mode: 'apply', database: databasePath, content, migration, imported, verification },
      null,
      2,
    ),
  );
} finally {
  database.close();
}
