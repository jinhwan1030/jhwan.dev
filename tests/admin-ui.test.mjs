import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { JSDOM } from 'jsdom';

import { createDemoAdminApi } from '../admin/src/demo-api.js';

const projectUrl = new URL('../', import.meta.url);

test('admin shell keeps the post list visible before the editor and avoids remote assets', async () => {
  const html = await readFile(new URL('admin/index.html', projectUrl), 'utf8');

  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive"/);
  assert.ok(html.indexOf('id="post-sidebar"') < html.indexOf('id="post-title"'));
  assert.match(html, /id="post-list"/);
  assert.match(html, /id="rich-editor"/);
  assert.match(html, /id="markdown-source"/);
  assert.match(html, /id="article-preview"/);
  assert.match(html, /id="save-post"/);
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]+(?:src|href)="https?:\/\//);
  assert.match(html, /href="https:\/\/auth\.jhwan\.dev\/admin\/auth"/);
});

test('demo API supports create, update, soft delete, restore, and revision history', async () => {
  const timestamp = Date.parse('2026-08-19T09:00:00.000Z');
  const api = createDemoAdminApi({ clock: () => timestamp });
  const input = {
    slug: 'new-admin-post',
    title: '새 관리자 글',
    description: '관리자 화면 CRUD 검증용 글입니다.',
    bodyMarkdown: '## 본문\n\n내용입니다.\n',
    category: '개발',
    status: 'draft',
    heroImagePath: null,
    publishedAt: null,
  };

  const created = await api.createPost(input);
  assert.equal(created.version, 1);
  assert.equal(created.deletedAt, null);

  const updated = await api.updatePost(created.id, {
    ...input,
    expectedVersion: created.version,
    title: '수정한 관리자 글',
    status: 'published',
  });
  assert.equal(updated.version, 2);
  assert.equal(updated.status, 'published');
  assert.equal(updated.publishedAt, '2026-08-19T09:00:00.000Z');

  await assert.rejects(
    api.updatePost(created.id, { ...input, expectedVersion: 1 }),
    (error) => error.code === 'version_conflict' && error.status === 409,
  );

  const deleted = await api.deletePost(created.id, { expectedVersion: updated.version });
  assert.equal(deleted.version, 3);
  assert.ok(deleted.deletedAt);

  const restored = await api.restorePost(created.id, { expectedVersion: deleted.version });
  assert.equal(restored.version, 4);
  assert.equal(restored.deletedAt, null);

  const revisions = await api.listRevisions(created.id);
  assert.deepEqual(revisions.map((revision) => revision.version), [4, 3, 2, 1]);
});

test('demo API protects both current and existing slugs', async () => {
  const api = createDemoAdminApi();
  const existing = await api.getPost('demo-1');

  await assert.rejects(
    api.createPost({
      ...existing,
      id: undefined,
      slug: existing.slug,
      title: '중복 주소',
    }),
    (error) => error.code === 'slug_conflict' && error.status === 409,
  );
});

test('visual editor preserves common Markdown structures during round trips', async (context) => {
  const dom = new JSDOM('<!doctype html><div id="editor"></div>', {
    pretendToBeVisual: true,
    url: 'https://admin.local/',
  });
  const previousGlobals = new Map();
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    DOMParser: dom.window.DOMParser,
    Node: dom.window.Node,
    Text: dom.window.Text,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    KeyboardEvent: dom.window.KeyboardEvent,
    InputEvent: dom.window.InputEvent,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  };

  for (const [key, value] of Object.entries(globals)) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  let editor;
  context.after(() => {
    editor?.destroy();
    dom.window.close();
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });

  const { createMarkdownEditor, setMarkdown } = await import('../admin/src/editor.js');
  const source = [
    '## 제목',
    '',
    '**굵은 글씨**와 `인라인 코드`',
    '',
    '- 첫 항목',
    '- 둘째 항목',
    '',
    '| 항목 | 상태 |',
    '| --- | --- |',
    '| SQLite | 준비됨 |',
    '',
    '```js',
    "console.log('admin');",
    '```',
    '',
  ].join('\n');

  editor = createMarkdownEditor({ element: dom.window.document.querySelector('#editor'), content: source });
  const firstRoundTrip = editor.getMarkdown();
  assert.match(firstRoundTrip, /^## 제목/m);
  assert.match(firstRoundTrip, /\*\*굵은 글씨\*\*/);
  assert.match(firstRoundTrip, /`인라인 코드`/);
  assert.match(firstRoundTrip, /SQLite/);
  assert.match(firstRoundTrip, /console\.log\('admin'\)/);

  setMarkdown(editor, firstRoundTrip, false);
  const secondRoundTrip = editor.getMarkdown();
  assert.match(secondRoundTrip, /\|\s*항목\s*\|\s*상태\s*\|/);
  assert.match(secondRoundTrip, /```js[\s\S]*console\.log\('admin'\);?[\s\S]*```/);
});
