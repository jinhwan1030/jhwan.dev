import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  analyzeLegacyContent,
  importAnalyzedLegacyContent,
} from '../scripts/lib/legacy-content-migration.mjs';
import { openDatabase, verifyDatabase } from '../src/lib/server/database.js';
import { migrateDatabase } from '../src/lib/server/migrations.js';
import { createPostRepository } from '../src/lib/server/post-repository.js';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function makeLegacyProject() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-legacy-'));
  const contentDirectory = path.join(projectRoot, 'src/content/blog');
  const mediaSource = path.join(projectRoot, 'src/assets/blog');
  fs.mkdirSync(contentDirectory, { recursive: true });
  fs.mkdirSync(mediaSource, { recursive: true });
  fs.writeFileSync(path.join(mediaSource, '대표 이미지.png'), ONE_PIXEL_PNG);
  fs.writeFileSync(path.join(mediaSource, '동일 이미지.png'), ONE_PIXEL_PNG);
  fs.writeFileSync(path.join(contentDirectory, 'legacy.md'), `---
title: 기존 글
description: 기존 글 설명
pubDate: 2026-08-01
updatedDate: ''
heroImage: ../../assets/blog/대표 이미지.png
category: 개발
draft: false
---

본문 이미지입니다.

![대표 이미지](../../assets/blog/%EB%8C%80%ED%91%9C%20%EC%9D%B4%EB%AF%B8%EC%A7%80.png)
`);
  return { projectRoot, contentDirectory, mediaSource };
}

test('migrates Markdown and media once, rewrites managed paths, and remains idempotent', async (context) => {
  const fixture = makeLegacyProject();
  const databasePath = path.join(fixture.projectRoot, 'data/content.db');
  const uploads = path.join(fixture.projectRoot, 'data/uploads');
  context.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));

  const analysis = await analyzeLegacyContent(fixture);
  assert.deepEqual(analysis.summary.content, { total: 1, published: 1, draft: 0 });
  assert.deepEqual(analysis.summary.media, {
    total: 2,
    unique: 1,
    referenced: 1,
    unreferenced: 0,
    bytes: ONE_PIXEL_PNG.length * 2,
  });
  assert.match(analysis.posts[0].heroImagePath, /^\/uploads\/[a-f0-9]{64}\.png$/);
  assert.match(analysis.posts[0].bodyMarkdown, /!\[대표 이미지\]\(\/uploads\/[a-f0-9]{64}\.png\)/);
  assert.equal(analysis.posts[0].heroMediaId, analysis.media[0].id);

  const first = importAnalyzedLegacyContent(analysis, {
    apply: true,
    databasePath,
    mediaDestination: uploads,
  });
  assert.deepEqual(first.imported.posts, { created: 1, updated: 0, unchanged: 0 });
  assert.deepEqual(first.imported.media, { created: 1, unchanged: 0 });
  assert.equal(first.copiedMedia, 1);

  const copiedFile = path.join(uploads, analysis.media[0].storageKey);
  assert.deepEqual(fs.readFileSync(copiedFile), ONE_PIXEL_PNG);

  const second = importAnalyzedLegacyContent(analysis, {
    apply: true,
    databasePath,
    mediaDestination: uploads,
  });
  assert.deepEqual(second.imported.posts, { created: 0, updated: 0, unchanged: 1 });
  assert.deepEqual(second.imported.media, { created: 0, unchanged: 1 });
  assert.equal(second.copiedMedia, 0);

  const database = openDatabase(databasePath, { readOnly: true });
  try {
    const post = database.prepare('SELECT * FROM posts WHERE slug = ?').get('legacy');
    assert.equal(post.hero_image_path, analysis.posts[0].heroImagePath);
    assert.equal(post.hero_media_id, analysis.media[0].id);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM media').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM post_revisions').get().count, 1);
    assert.deepEqual(verifyDatabase(database), { integrity: 'ok', foreignKeyViolations: 0 });
  } finally {
    database.close();
  }
});

test('rolls back database metadata and newly copied media when a post conflicts', async (context) => {
  const fixture = makeLegacyProject();
  const databasePath = path.join(fixture.projectRoot, 'data/content.db');
  const uploads = path.join(fixture.projectRoot, 'data/uploads');
  context.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));

  const database = openDatabase(databasePath);
  try {
    migrateDatabase(database);
    createPostRepository(database, { idGenerator: () => 'admin-post' }).create({
      slug: 'legacy',
      title: '관리자 글',
      description: '충돌 확인용',
      bodyMarkdown: '관리자 본문',
      category: '개발',
      status: 'draft',
      heroImagePath: null,
      publishedAt: null,
    });
  } finally {
    database.close();
  }

  const analysis = await analyzeLegacyContent(fixture);
  assert.throws(
    () => importAnalyzedLegacyContent(analysis, {
      apply: true,
      databasePath,
      mediaDestination: uploads,
    }),
    /belongs to a database post/,
  );

  const managedFiles = fs.existsSync(uploads)
    ? fs.readdirSync(uploads).filter((name) => !name.startsWith('.'))
    : [];
  assert.deepEqual(managedFiles, []);

  const verified = openDatabase(databasePath, { readOnly: true });
  try {
    assert.equal(verified.prepare('SELECT COUNT(*) AS count FROM posts').get().count, 1);
    assert.equal(verified.prepare('SELECT COUNT(*) AS count FROM media').get().count, 0);
    assert.deepEqual(verifyDatabase(verified), { integrity: 'ok', foreignKeyViolations: 0 });
  } finally {
    verified.close();
  }
});

test('rejects symbolic links in the legacy media source', async (context) => {
  const fixture = makeLegacyProject();
  const outside = path.join(fixture.projectRoot, 'outside.png');
  fs.writeFileSync(outside, ONE_PIXEL_PNG);
  fs.symlinkSync(outside, path.join(fixture.mediaSource, 'linked.png'));
  context.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));

  await assert.rejects(() => analyzeLegacyContent(fixture), /Symbolic links are not allowed/);
});

test('rejects a missing media source instead of silently treating it as empty', async (context) => {
  const fixture = makeLegacyProject();
  fs.rmSync(fixture.mediaSource, { recursive: true });
  context.after(() => fs.rmSync(fixture.projectRoot, { recursive: true, force: true }));

  await assert.rejects(() => analyzeLegacyContent(fixture), /Legacy media source does not exist/);
});
