import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createContentRuntime } from '../src/lib/server/content-runtime.js';
import { renderMarkdown } from '../src/lib/server/render-markdown.js';

function makeContentDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-content-runtime-'));
  fs.writeFileSync(path.join(directory, 'published.md'), `---
title: 공개 글
description: 공개 설명
pubDate: 2026-01-01
updatedDate: ''
heroImage: ''
category: 개발
draft: false
---
## 공개 본문
`);
  fs.writeFileSync(path.join(directory, 'draft.md'), `---
title: 초안 글
description: 초안 설명
pubDate: 2026-01-02
updatedDate: ''
heroImage: ''
category: 개발
draft: true
---
초안 본문
`);
  fs.writeFileSync(path.join(directory, 'scheduled.md'), `---
title: 예약 글
description: 예약 설명
pubDate: 2099-01-01
updatedDate: ''
heroImage: ''
category: 개발
draft: false
---
예약 본문
`);
  return directory;
}

test('content runtime migrates and seeds an empty database exactly once', (context) => {
  const contentDirectory = makeContentDirectory();
  const databasePath = path.join(contentDirectory, 'content.db');
  context.after(() => fs.rmSync(contentDirectory, { recursive: true, force: true }));

  const first = createContentRuntime({ databasePath, contentDirectory });
  assert.equal(first.seed.seeded, true);
  assert.equal(first.seed.count, 3);
  assert.deepEqual(first.repository.listPublished('2026-08-19T00:00:00.000Z').map((post) => post.slug), ['published']);
  first.database.close();

  fs.writeFileSync(path.join(contentDirectory, 'new-source.md'), `---
title: 나중에 생긴 원본
description: 자동 재가져오기가 되면 안 됩니다.
pubDate: 2026-01-03
updatedDate: ''
heroImage: ''
category: 개발
draft: false
---
본문
`);
  const second = createContentRuntime({ databasePath, contentDirectory });
  assert.equal(second.seed.seeded, false);
  assert.equal(second.seed.count, 3);
  assert.equal(second.repository.findBySlug('new-source'), null);
  second.database.close();
});

test('Markdown rendering removes executable HTML and unsafe URLs', () => {
  const html = renderMarkdown(`## 안전한 제목

[정상 링크](https://example.com)

[위험 링크](javascript:alert(1))

<script>alert('xss')</script>

<img src="javascript:alert(2)" onerror="alert(3)" alt="위험 이미지">
`);

  assert.match(html, /<h2>안전한 제목<\/h2>/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<script|javascript:|onerror/i);
});
