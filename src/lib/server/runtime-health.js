import fs from 'node:fs';
import path from 'node:path';

import { getContentRuntime } from './content-runtime.js';

export function checkRuntimeHealth({
  contentRuntime = getContentRuntime(),
  mediaPath = process.env.JHWAN_MEDIA_PATH ?? path.resolve('.data/uploads'),
  fileSystem = fs,
} = {}) {
  const postsTable = contentRuntime.database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'posts'")
    .get();
  if (postsTable?.name !== 'posts') throw new Error('Content database schema is unavailable');

  const resolvedMediaPath = path.resolve(mediaPath);
  const mediaStat = fileSystem.statSync(resolvedMediaPath);
  if (!mediaStat.isDirectory()) throw new Error('Managed media path is not a directory');
  fileSystem.accessSync(resolvedMediaPath, fs.constants.R_OK | fs.constants.W_OK);

  return {
    status: 'ok',
    checks: {
      database: 'ok',
      mediaStorage: 'ok',
    },
  };
}
