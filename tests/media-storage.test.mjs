import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openDatabase } from '../src/lib/server/database.js';
import {
  createManagedMediaResponse,
  ManagedMediaError,
  storeManagedMedia,
} from '../src/lib/server/media-storage.js';
import { migrateDatabase } from '../src/lib/server/migrations.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zr9sAAAAASUVORK5CYII=',
  'base64',
);

test('serves only content-addressed media with immutable caching', async (context) => {
  const mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-media-'));
  const contents = Buffer.from('not decoded by this storage-level test');
  const checksum = createHash('sha256').update(contents).digest('hex');
  const storageKey = `${checksum}.png`;
  fs.writeFileSync(path.join(mediaRoot, storageKey), contents);
  context.after(() => fs.rmSync(mediaRoot, { recursive: true, force: true }));

  const response = await createManagedMediaResponse(storageKey, { mediaRoot });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), contents);

  const etag = response.headers.get('ETag');
  const cached = await createManagedMediaResponse(storageKey, { mediaRoot, ifNoneMatch: etag });
  assert.equal(cached.status, 304);

  const head = await createManagedMediaResponse(storageKey, { mediaRoot, method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('Content-Length'), String(contents.length));
});

test('rejects invalid keys and symlinks escaping the media root', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-media-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-media-outside-'));
  const checksum = 'a'.repeat(64);
  const storageKey = `${checksum}.jpg`;
  fs.writeFileSync(path.join(outside, 'outside.jpg'), 'outside');
  fs.symlinkSync(path.join(outside, 'outside.jpg'), path.join(root, storageKey));
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  assert.equal((await createManagedMediaResponse('../outside.jpg', { mediaRoot: root })).status, 404);
  assert.equal((await createManagedMediaResponse(storageKey, { mediaRoot: root })).status, 404);
});

test('validates, stores, and deduplicates administrator image uploads', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-media-upload-'));
  const mediaRoot = path.join(root, 'uploads');
  const database = openDatabase(path.join(root, 'content.db'));
  migrateDatabase(database);
  context.after(() => {
    database.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const uploads = await Promise.all([
    storeManagedMedia(database, {
      contents: PNG,
      originalName: '대표 이미지.png',
      declaredMimeType: 'image/png',
      altText: '대표 이미지',
      mediaRoot,
    }),
    storeManagedMedia(database, {
      contents: PNG,
      originalName: '동시 업로드.png',
      declaredMimeType: 'image/png',
      mediaRoot,
    }),
  ]);
  const created = uploads.find((media) => !media.deduplicated);
  const concurrentDuplicate = uploads.find((media) => media.deduplicated);
  assert.ok(created);
  assert.ok(concurrentDuplicate);
  assert.equal(concurrentDuplicate.id, created.id);
  assert.equal(created.deduplicated, false);
  assert.equal(created.mimeType, 'image/png');
  assert.equal(created.byteSize, PNG.length);
  assert.equal(created.width, 1);
  assert.equal(created.height, 1);
  assert.match(created.storageKey, /^[a-f0-9]{64}\.png$/);
  assert.equal(created.url, `/uploads/${created.storageKey}`);
  assert.deepEqual(fs.readFileSync(path.join(mediaRoot, created.storageKey)), PNG);

  const duplicate = await storeManagedMedia(database, {
    contents: PNG,
    originalName: 'duplicate.png',
    declaredMimeType: 'image/png',
    mediaRoot,
  });
  assert.equal(duplicate.id, created.id);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM media').get().count, 1);

  await assert.rejects(
    () => storeManagedMedia(database, {
      contents: Buffer.from('<svg onload="alert(1)"></svg>'),
      originalName: 'attack.svg',
      declaredMimeType: 'image/svg+xml',
      mediaRoot,
    }),
    (error) => error instanceof ManagedMediaError && error.code === 'invalid_media',
  );
  await assert.rejects(
    () => storeManagedMedia(database, {
      contents: PNG,
      originalName: 'wrong.jpg',
      declaredMimeType: 'image/jpeg',
      mediaRoot,
    }),
    (error) => error instanceof ManagedMediaError && error.code === 'media_type_mismatch',
  );
});
