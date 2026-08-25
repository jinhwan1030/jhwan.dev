import path from 'node:path';

import { openDatabase } from '../../src/lib/server/database.js';
import { verifyContentBackup } from './content-backup.mjs';

function publicSnapshot(databasePath, now) {
  const database = openDatabase(path.resolve(databasePath), { readOnly: true });
  try {
    return {
      posts: database.prepare(`
        SELECT slug FROM posts
        WHERE status = 'published'
          AND deleted_at IS NULL
          AND published_at IS NOT NULL
          AND published_at <= ?
        ORDER BY slug
      `).all(now),
      media: database.prepare(`
        SELECT storage_key, byte_size FROM media ORDER BY storage_key
      `).all(),
    };
  } finally {
    database.close();
  }
}

async function fetchResponse(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(10_000),
    ...options,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Restore rehearsal request failed (${response.status}): ${url}`);
  }
  return response;
}

async function waitUntilReady(fetchImpl, origin, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetchResponse(fetchImpl, `${origin}/api/health`);
      await response.body?.cancel();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Isolated homepage did not become ready: ${lastError?.message ?? 'timeout'}`);
}

export async function verifyRestoredRuntime({
  origin,
  databasePath,
  mediaRoot,
  fetchImpl = fetch,
  now = new Date().toISOString(),
  readyTimeoutMilliseconds = 45_000,
}) {
  const normalizedOrigin = new URL(origin);
  if (!['http:', 'https:'].includes(normalizedOrigin.protocol)) {
    throw new Error(`Unsupported rehearsal origin: ${normalizedOrigin.protocol}`);
  }
  const base = normalizedOrigin.href.replace(/\/$/, '');
  const backup = verifyContentBackup({ databasePath, mediaRoot });
  const snapshot = publicSnapshot(databasePath, now);

  await waitUntilReady(fetchImpl, base, readyTimeoutMilliseconds);
  const blog = await (await fetchResponse(fetchImpl, `${base}/blog/`)).text();
  const homeResponse = await fetchResponse(fetchImpl, `${base}/`);
  await homeResponse.body?.cancel();
  const rss = await (await fetchResponse(fetchImpl, `${base}/rss.xml`)).text();
  const sitemap = await (await fetchResponse(fetchImpl, `${base}/sitemap.xml`)).text();
  const decodedRss = decodeURIComponent(rss);
  const decodedSitemap = decodeURIComponent(sitemap);

  for (const { slug } of snapshot.posts) {
    const pathName = `/blog/${slug}/`;
    const encodedPath = `/blog/${slug.split('/').map(encodeURIComponent).join('/')}/`;
    if (!blog.includes(pathName) && !blog.includes(encodedPath)) {
      throw new Error(`Published post is missing from the restored blog index: ${slug}`);
    }
    if (!decodedRss.includes(pathName)) {
      throw new Error(`Published post is missing from the restored RSS: ${slug}`);
    }
    if (!decodedSitemap.includes(pathName)) {
      throw new Error(`Published post is missing from the restored sitemap: ${slug}`);
    }
    const detail = await fetchResponse(fetchImpl, `${base}${encodedPath}`);
    await detail.body?.cancel();
  }

  for (const media of snapshot.media) {
    const response = await fetchResponse(
      fetchImpl,
      `${base}/uploads/${encodeURIComponent(media.storage_key)}`,
      { method: 'HEAD' },
    );
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength !== media.byte_size) {
      throw new Error(`Restored media response size mismatch: ${media.storage_key}`);
    }
    await response.body?.cancel();
  }

  const adminResponse = await fetchImpl(`${base}/api/admin/session`, {
    signal: AbortSignal.timeout(10_000),
  });
  const adminBody = await adminResponse.json().catch(() => null);
  if (adminResponse.status !== 503 || adminBody?.error?.code !== 'admin_disabled') {
    throw new Error('Administrator API must remain disabled during a restore rehearsal');
  }

  return {
    backup,
    runtime: {
      publishedPosts: snapshot.posts.length,
      media: snapshot.media.length,
      adminApiDisabled: true,
    },
  };
}
