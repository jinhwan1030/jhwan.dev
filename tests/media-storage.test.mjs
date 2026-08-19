import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createManagedMediaResponse } from '../src/lib/server/media-storage.js';

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
