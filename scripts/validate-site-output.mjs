import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadMarkdownPosts } from './lib/markdown-posts.mjs';
import { startRuntimeServer } from './lib/runtime-server.mjs';

const siteOrigin = 'https://jhwan.dev';
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-runtime-site-'));
const server = await startRuntimeServer({ databasePath: path.join(temporaryDirectory, 'content.db') });
const publicPosts = loadMarkdownPosts(path.resolve('src/content/blog')).filter(
  (post) => post.status === 'published' && Date.parse(post.publishedAt) <= Date.now(),
);

try {
  const pages = ['/', '/about/', '/blog/', ...publicPosts.map((post) => `/blog/${post.slug}/`)];
  const errors = [];
  const checkedReferences = new Set();

  for (const pathname of pages) {
    const response = await fetch(`${server.origin}${pathname}`);
    if (!response.ok) {
      errors.push(`${pathname}: HTTP ${response.status}`);
      continue;
    }
    const source = await response.text();
    const canonical = new URL(pathname, siteOrigin).href;
    if (!source.includes(`<link rel="canonical" href="${canonical}">`)) {
      errors.push(`${pathname}: missing canonical URL`);
    }
    if (pathname.startsWith('/blog/') && pathname !== '/blog/') {
      for (const metadata of [
        '<meta property="og:type" content="article">',
        '<meta property="article:published_time"',
        `<meta property="og:url" content="${canonical}">`,
      ]) {
        if (!source.includes(metadata)) errors.push(`${pathname}: missing metadata ${metadata}`);
      }
    }

    for (const match of source.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
      const reference = match[1];
      if (!reference.startsWith('/') || reference.startsWith('//')) continue;
      const referencePath = reference.split(/[?#]/, 1)[0];
      if (checkedReferences.has(referencePath)) continue;
      checkedReferences.add(referencePath);
      const linked = await fetch(`${server.origin}${referencePath}`);
      if (!linked.ok) errors.push(`${pathname}: broken internal reference ${referencePath} (${linked.status})`);
    }
  }

  for (const endpoint of ['/rss.xml', '/sitemap.xml']) {
    const response = await fetch(`${server.origin}${endpoint}`);
    if (!response.ok) errors.push(`${endpoint}: HTTP ${response.status}`);
  }

  if (errors.length > 0) throw new Error(`Runtime site validation failed:\n${errors.join('\n')}`);
  console.log(
    `Runtime site validation passed (${pages.length} HTML responses, ${checkedReferences.size} internal references)`,
  );
} finally {
  await server.stop();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
