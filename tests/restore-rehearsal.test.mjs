import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyRestoredRuntime } from '../scripts/lib/restore-rehearsal.mjs';
import { openDatabase } from '../src/lib/server/database.js';
import { migrateDatabase } from '../src/lib/server/migrations.js';
import { createPostRepository } from '../src/lib/server/post-repository.js';

const REHEARSAL_SCRIPT = path.resolve('deploy/raspberry-pi/rehearse-homepage-restore.sh');

function createFixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-restore-rehearsal-'));
  const databasePath = path.join(root, 'jhwan.db');
  const mediaRoot = path.join(root, 'uploads');
  fs.mkdirSync(mediaRoot);
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const database = openDatabase(databasePath);
  migrateDatabase(database);
  const repository = createPostRepository(database, {
    idGenerator: (() => {
      let id = 0;
      return () => `post-${++id}`;
    })(),
  });
  repository.create({
    slug: 'restored-post',
    title: '복원 글',
    description: '격리 복원 검증',
    bodyMarkdown: '본문',
    category: '개발',
    status: 'published',
    heroImagePath: null,
    publishedAt: '2026-08-20T00:00:00.000Z',
  });
  repository.create({
    slug: 'draft-post',
    title: '초안',
    description: '공개되면 안 됨',
    bodyMarkdown: '본문',
    category: '개발',
    status: 'draft',
    heroImagePath: null,
    publishedAt: null,
  });

  const contents = Buffer.from('restored media');
  const mediaId = createHash('sha256').update(contents).digest('hex');
  const storageKey = `${mediaId}.png`;
  fs.writeFileSync(path.join(mediaRoot, storageKey), contents);
  database.prepare(`
    INSERT INTO media (
      id, storage_key, original_name, mime_type, byte_size, width, height,
      alt_text, created_at, updated_at
    ) VALUES (?, ?, 'restore.png', 'image/png', ?, 1, 1, '', ?, ?)
  `).run(
    mediaId,
    storageKey,
    contents.length,
    '2026-08-20T00:00:00.000Z',
    '2026-08-20T00:00:00.000Z',
  );
  database.close();

  return { databasePath, mediaRoot, storageKey, mediaBytes: contents.length };
}

test('verifies an isolated restored runtime without exposing the administrator API', async (context) => {
  const fixture = createFixture(context);
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    requests.push({ path: parsed.pathname, method: options.method ?? 'GET' });
    switch (parsed.pathname) {
      case '/': return new Response('home');
      case '/blog/': return new Response('<a href="/blog/restored-post/">복원 글</a>');
      case '/blog/restored-post/': return new Response('<article>복원 글</article>');
      case '/rss.xml': return new Response('<link>http://homepage/blog/restored-post/</link>');
      case '/sitemap.xml': return new Response('<loc>http://homepage/blog/restored-post/</loc>');
      case `/uploads/${fixture.storageKey}`:
        return new Response(null, { headers: { 'content-length': String(fixture.mediaBytes) } });
      case '/api/admin/session':
        return Response.json(
          { error: { code: 'admin_disabled', message: 'disabled' } },
          { status: 503 },
        );
      default: return new Response('not found', { status: 404 });
    }
  };

  const result = await verifyRestoredRuntime({
    origin: 'http://homepage:8080',
    databasePath: fixture.databasePath,
    mediaRoot: fixture.mediaRoot,
    fetchImpl,
    now: '2026-08-21T00:00:00.000Z',
    readyTimeoutMilliseconds: 1_000,
  });

  assert.deepEqual(result.runtime, {
    publishedPosts: 1,
    media: 1,
    adminApiDisabled: true,
  });
  assert.equal(result.backup.counts.posts, 2);
  assert.ok(requests.some((request) => request.path === '/blog/restored-post/'));
  assert.ok(requests.some(
    (request) => request.path === `/uploads/${fixture.storageKey}` && request.method === 'HEAD',
  ));
  assert.ok(!requests.some((request) => request.path === '/blog/draft-post/'));
});

test('rejects a restored runtime whose media response does not match the backup', async (context) => {
  const fixture = createFixture(context);
  const fetchImpl = async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname === '/blog/') return new Response('/blog/restored-post/');
    if (pathname === '/rss.xml' || pathname === '/sitemap.xml') {
      return new Response('/blog/restored-post/');
    }
    if (pathname === `/uploads/${fixture.storageKey}`) {
      return new Response(null, { headers: { 'content-length': '999' } });
    }
    return new Response('ok');
  };

  await assert.rejects(
    () => verifyRestoredRuntime({
      origin: 'http://homepage:8080',
      databasePath: fixture.databasePath,
      mediaRoot: fixture.mediaRoot,
      fetchImpl,
      now: '2026-08-21T00:00:00.000Z',
      readyTimeoutMilliseconds: 1_000,
    }),
    /media response size mismatch/,
  );
});

test('keeps the rehearsal off production data and host ports', () => {
  const source = fs.readFileSync(REHEARSAL_SCRIPT, 'utf8');

  assert.match(source, /mktemp -d \/tmp\/jhwan-homepage-restore-rehearsal/);
  assert.match(source, /--env JHWAN_ADMIN_ENABLED=false/);
  assert.match(source, /--network-alias homepage/);
  assert.doesNotMatch(source, /--publish|-p [0-9]/);
  assert.doesNotMatch(source, /JHWAN_HOMEPAGE_DATA_DIR|\/projects\/jhwan-homepage\/data/);
});
