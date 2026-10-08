import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { JSDOM } from 'jsdom';

import { createDemoAdminApi } from '../admin/src/demo-api.js';

const projectUrl = new URL('../', import.meta.url);

test('admin shell keeps the post list visible before the editor and avoids remote assets', async () => {
  const html = await readFile(new URL('admin/index.html', projectUrl), 'utf8');
  const mainSource = await readFile(new URL('admin/src/main.js', projectUrl), 'utf8');

  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive"/);
  assert.ok(html.indexOf('id="post-sidebar"') < html.indexOf('id="post-title"'));
  assert.match(html, /id="post-list"/);
  assert.match(html, /id="rich-editor"/);
  assert.match(html, /id="markdown-source"/);
  assert.match(html, /id="article-preview"/);
  assert.match(html, /id="save-post"/);
  assert.match(html, /id="save-post"[^>]+disabled/);
  assert.match(html, /id="insert-image"/);
  assert.match(html, /id="upload-image"/);
  assert.match(html, /id="image-file"/);
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]+(?:src|href)="https?:\/\//);
  assert.match(html, /href="https:\/\/auth\.jhwan\.dev\/admin\/auth"/);
  assert.match(html, /id="auth-screen" aria-labelledby="auth-title">/);
  assert.match(html, /id="auth-login"[^>]+hidden/);
  assert.match(html, /class="brand" href="\/admin\/"/);
  assert.match(html, /id="status-filters" role="group"/);
  assert.match(html, /id="visual-tab"[^>]+aria-controls="visual-pane"[^>]+tabindex="0"/);
  assert.match(html, /id="markdown-tab"[^>]+aria-controls="markdown-pane"[^>]+tabindex="-1"/);
  assert.match(html, /id="visual-pane" role="tabpanel" aria-labelledby="visual-tab"/);
  assert.match(mainSource, /event\.key === 'ArrowRight'/);
  assert.match(mainSource, /event\.key === 'ArrowLeft'/);
  assert.match(mainSource, /tab\.tabIndex = active \? 0 : -1/);
  assert.doesNotMatch(mainSource, /^import .*\.\/editor\.js/m);
  assert.match(mainSource, /await import\('\.\/editor\.js'\)/);
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

function installDomGlobals(dom) {
  const previousGlobals = new Map();
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    localStorage: dom.window.localStorage,
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

  return () => {
    dom.window.close();
    for (const [key, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

async function waitFor(predicate, message, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

test('visual editor preserves common Markdown structures during round trips', async (context) => {
  const dom = new JSDOM('<!doctype html><div id="editor"></div>', {
    pretendToBeVisual: true,
    url: 'https://admin.local/',
  });
  const restoreGlobals = installDomGlobals(dom);

  let editor;
  context.after(() => {
    editor?.destroy();
    restoreGlobals();
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
    '![관리자 이미지](/uploads/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png)',
    '',
  ].join('\n');

  editor = createMarkdownEditor({ element: dom.window.document.querySelector('#editor'), content: source });
  const firstRoundTrip = editor.getMarkdown();
  assert.match(firstRoundTrip, /^## 제목/m);
  assert.match(firstRoundTrip, /\*\*굵은 글씨\*\*/);
  assert.match(firstRoundTrip, /`인라인 코드`/);
  assert.match(firstRoundTrip, /SQLite/);
  assert.match(firstRoundTrip, /console\.log\('admin'\)/);
  assert.match(firstRoundTrip, /!\[관리자 이미지\]\(\/uploads\/a{64}\.png\)/);

  setMarkdown(editor, firstRoundTrip, false);
  const secondRoundTrip = editor.getMarkdown();
  assert.match(secondRoundTrip, /\|\s*항목\s*\|\s*상태\s*\|/);
  assert.match(secondRoundTrip, /```js[\s\S]*console\.log\('admin'\);?[\s\S]*```/);
});

test('browser recovery restores the hero image and is not resurrected by a quick save', async (context) => {
  const html = await readFile(new URL('admin/index.html', projectUrl), 'utf8');
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'https://admin.local/admin/?demo=1' });
  dom.window.confirm = () => true;
  const restoreGlobals = installDomGlobals(dom);
  context.after(restoreGlobals);

  const recoveryKey = 'jhwan-admin-recovery:demo-1';
  const recoveredHero = `/uploads/${'b'.repeat(64)}.png`;
  dom.window.localStorage.setItem(recoveryKey, JSON.stringify({
    savedAt: '2099-01-01T00:00:00.000Z',
    input: {
      title: '복구된 제목',
      slug: 'database-content-preview',
      description: '브라우저에 남은 임시 저장본입니다.',
      bodyMarkdown: '## 복구된 본문\n',
      category: '개발',
      status: 'published',
      heroImagePath: recoveredHero,
      publishedAt: '2026-08-19T03:00:00.000Z',
    },
  }));

  // Evaluated once per process; the demo flag in the URL selects the in-memory API.
  await import('../admin/src/main.js');
  const document = dom.window.document;
  const title = document.querySelector('#post-title');
  const heroPath = document.querySelector('#hero-preview-path');
  const versionLabel = document.querySelector('#version-label');
  await waitFor(() => title.value === '복구된 제목', 'the recovered draft');
  assert.equal(heroPath.textContent, recoveredHero);

  // Save within the 800 ms local-recovery debounce window.
  title.value = '복구 후 바로 저장';
  title.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  document.querySelector('#save-post').click();
  await waitFor(() => versionLabel.textContent === '버전 4', 'the saved post');
  assert.equal(heroPath.textContent, recoveredHero);

  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(dom.window.localStorage.getItem(recoveryKey), null);
});
