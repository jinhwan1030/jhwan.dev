import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadMarkdownPosts, summarizeMarkdownPosts } from '../scripts/lib/markdown-posts.mjs';
import { openDatabase, verifyDatabase } from '../src/lib/server/database.js';
import { migrateDatabase } from '../src/lib/server/migrations.js';
import { createPostRepository } from '../src/lib/server/post-repository.js';

function writePost(directory, filename, { title, draft, body, updatedDate = "''" }) {
  fs.writeFileSync(
    path.join(directory, filename),
    `---
title: ${title}
description: Import test description
pubDate: 2026-08-19
updatedDate: ${updatedDate}
heroImage: ''
category: 개발
draft: ${draft}
---

${body}
`,
  );
}

test('imports Markdown posts transactionally and keeps revisions', () => {
  const contentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-content-'));
  writePost(contentDirectory, 'published.md', {
    title: 'Published post',
    draft: false,
    body: 'First published body.',
  });
  writePost(contentDirectory, 'draft.md', {
    title: 'Draft post',
    draft: true,
    body: 'Private draft body.',
  });

  const database = openDatabase(':memory:');
  let nextId = 0;
  try {
    migrateDatabase(database);
    const repository = createPostRepository(database, { idGenerator: () => `post-${++nextId}` });
    const firstPosts = loadMarkdownPosts(contentDirectory, { sourcePrefix: 'test-content' });

    assert.deepEqual(summarizeMarkdownPosts(firstPosts), { total: 2, published: 1, draft: 1 });
    assert.deepEqual(repository.importPosts(firstPosts), { created: 2, updated: 0, unchanged: 0 });
    assert.deepEqual(repository.importPosts(firstPosts), { created: 0, updated: 0, unchanged: 2 });

    const published = repository.findBySlug('published');
    assert.equal(published.status, 'published');
    assert.equal(published.heroImagePath, null);
    assert.equal(published.contentUpdatedAt, null);
    assert.equal(published.version, 1);

    writePost(contentDirectory, 'published.md', {
      title: 'Published post',
      draft: false,
      body: 'Revised published body.',
      updatedDate: '2026-08-20',
    });
    const revisedPosts = loadMarkdownPosts(contentDirectory, { sourcePrefix: 'test-content' });
    assert.deepEqual(repository.importPosts(revisedPosts), { created: 0, updated: 1, unchanged: 1 });

    const revised = repository.findBySlug('published');
    assert.equal(revised.bodyMarkdown.trim(), 'Revised published body.');
    assert.equal(revised.contentUpdatedAt, '2026-08-20T00:00:00.000Z');
    assert.equal(revised.version, 2);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM post_revisions').get().count, 3);
    assert.deepEqual(verifyDatabase(database), { integrity: 'ok', foreignKeyViolations: 0 });
  } finally {
    database.close();
    fs.rmSync(contentDirectory, { recursive: true, force: true });
  }
});

test('rolls back the whole import when a slug belongs to another source', () => {
  const contentDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-collision-'));
  writePost(contentDirectory, 'same-slug.md', {
    title: 'Original post',
    draft: false,
    body: 'Original body.',
  });

  const database = openDatabase(':memory:');
  try {
    migrateDatabase(database);
    const repository = createPostRepository(database, { idGenerator: () => 'stable-id' });
    const original = loadMarkdownPosts(contentDirectory, { sourcePrefix: 'first-source' });
    repository.importPosts(original);

    const conflicting = loadMarkdownPosts(contentDirectory, { sourcePrefix: 'second-source' });
    assert.throws(() => repository.importPosts(conflicting), /slug same-slug belongs to first-source/);
    assert.equal(repository.findBySlug('same-slug').sourcePath, 'first-source/same-slug.md');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM post_revisions').get().count, 1);
  } finally {
    database.close();
    fs.rmSync(contentDirectory, { recursive: true, force: true });
  }
});
