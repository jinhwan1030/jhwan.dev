import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SECURITY_HEADERS } from '../src/lib/server/security-headers.js';
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
    for (const [header, expected] of Object.entries(SECURITY_HEADERS)) {
      if (response.headers.get(header) !== expected) {
        errors.push(`${pathname}: invalid security header ${header}`);
      }
    }
    const canonical = new URL(pathname, siteOrigin).href;
    if (!source.includes(`<link rel="canonical" href="${canonical}">`)) {
      errors.push(`${pathname}: missing canonical URL`);
    }
    if (!source.includes('href="#main-content"') || !source.includes('id="main-content"')) {
      errors.push(`${pathname}: missing public skip-link target`);
    }
    if (!source.includes('<meta name="twitter:card" content="summary_large_image">')) {
      errors.push(`${pathname}: missing Twitter card metadata`);
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

  const notFound = await fetch(`${server.origin}/blog/__missing-accessibility-check__/`);
  const notFoundSource = await notFound.text();
  if (notFound.status !== 404) errors.push(`/blog/__missing-accessibility-check__/: expected HTTP 404`);
  if (!notFoundSource.includes('<meta name="robots" content="noindex, nofollow">')) {
    errors.push(`/blog/__missing-accessibility-check__/: missing noindex metadata`);
  }
  if (!notFoundSource.includes('href="#main-content"') || !notFoundSource.includes('id="main-content"')) {
    errors.push(`/blog/__missing-accessibility-check__/: missing public skip-link target`);
  }

  for (const endpoint of ['/rss.xml', '/sitemap.xml']) {
    const response = await fetch(`${server.origin}${endpoint}`);
    if (!response.ok) errors.push(`${endpoint}: HTTP ${response.status}`);
  }

  const health = await fetch(`${server.origin}/api/health`);
  const healthBody = await health.json().catch(() => null);
  if (health.status !== 200 || healthBody?.status !== 'ok') {
    errors.push(`/api/health: invalid readiness response (${health.status})`);
  }
  if (health.headers.get('cache-control') !== 'no-store') {
    errors.push('/api/health: missing no-store cache policy');
  }
  for (const [header, expected] of Object.entries(SECURITY_HEADERS)) {
    if (health.headers.get(header) !== expected) {
      errors.push(`/api/health: invalid security header ${header}`);
    }
  }
  const healthHead = await fetch(`${server.origin}/api/health`, { method: 'HEAD' });
  if (healthHead.status !== 200 || (await healthHead.text()) !== '') {
    errors.push(`/api/health: invalid HEAD response (${healthHead.status})`);
  }
  const healthPost = await fetch(`${server.origin}/api/health`, {
    method: 'POST',
    headers: { Origin: server.origin },
  });
  if (healthPost.status !== 405 || healthPost.headers.get('allow') !== 'GET, HEAD') {
    errors.push(`/api/health: invalid method boundary (${healthPost.status})`);
  }

  if (errors.length > 0) throw new Error(`Runtime site validation failed:\n${errors.join('\n')}`);
  console.log(
    `Runtime site validation passed (${pages.length} HTML responses, ${checkedReferences.size} internal references)`,
  );
} finally {
  await server.stop();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
