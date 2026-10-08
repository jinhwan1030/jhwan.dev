import fs from 'node:fs';

import { getContentRuntime } from './content-runtime.js';
import { resolveMediaRoot } from './media-storage.js';

export function checkRuntimeHealth({
  contentRuntime = getContentRuntime(),
  mediaPath,
  fileSystem = fs,
} = {}) {
  const postsTable = contentRuntime.database
    .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'posts'")
    .get();
  if (postsTable?.name !== 'posts') throw new Error('Content database schema is unavailable');

  // Check the same directory uploads are written to, including its fallback.
  const resolvedMediaPath = resolveMediaRoot(mediaPath);
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
