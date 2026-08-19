import fs from 'node:fs';
import path from 'node:path';

export const MANAGED_MEDIA_KEY_PATTERN = /^[a-f0-9]{64}\.(?:avif|gif|jpg|png|webp)$/;

const MEDIA_TYPES = Object.freeze({
  avif: 'image/avif',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

export function resolveMediaRoot(mediaRoot = process.env.JHWAN_MEDIA_PATH) {
  const configured = mediaRoot?.trim();
  return path.resolve(configured || '.data/uploads');
}

export function mediaTypeForKey(storageKey) {
  if (!MANAGED_MEDIA_KEY_PATTERN.test(storageKey)) return null;
  return MEDIA_TYPES[path.extname(storageKey).slice(1)] ?? null;
}

export async function createManagedMediaResponse(
  storageKey,
  { mediaRoot, method = 'GET', ifNoneMatch = null } = {},
) {
  const mimeType = mediaTypeForKey(storageKey);
  if (!mimeType) return new Response('Not found', { status: 404 });

  const root = resolveMediaRoot(mediaRoot);
  let rootRealPath;
  let fileRealPath;
  let stat;
  try {
    rootRealPath = await fs.promises.realpath(root);
    fileRealPath = await fs.promises.realpath(path.join(root, storageKey));
    const prefix = `${rootRealPath}${path.sep}`;
    if (!fileRealPath.startsWith(prefix)) return new Response('Not found', { status: 404 });
    stat = await fs.promises.stat(fileRealPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return new Response('Not found', { status: 404 });
    throw error;
  }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });

  const checksum = storageKey.slice(0, 64);
  const etag = `"${checksum}"`;
  const headers = {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': String(stat.size),
    'Content-Type': mimeType,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };
  if (ifNoneMatch === etag) return new Response(null, { status: 304, headers });
  if (method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(await fs.promises.readFile(fileRealPath), { status: 200, headers });
}
