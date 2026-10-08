import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { openDatabase } from '../src/lib/server/database.js';
import { createPostRepository } from '../src/lib/server/post-repository.js';
import { loadMarkdownPosts } from './lib/markdown-posts.mjs';
import { startRuntimeServer } from './lib/runtime-server.mjs';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npmCommand, ['run', 'build'], { stdio: 'inherit' });
if (build.status !== 0) throw new Error(`Production build failed with status ${build.status}`);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'jhwan-runtime-blog-'));
const databasePath = path.join(temporaryDirectory, 'content.db');
const sourcePosts = loadMarkdownPosts(path.resolve('src/content/blog'));
// Run with the production container's UTC clock so public dates must be pinned to KST.
const server = await startRuntimeServer({ databasePath, environment: { TZ: 'UTC' } });

try {
  const indexResponse = await fetch(`${server.origin}/blog/`);
  const index = await indexResponse.text();
  const rss = await (await fetch(`${server.origin}/rss.xml`)).text();
  const sitemap = await (await fetch(`${server.origin}/sitemap.xml`)).text();
  const decodedRss = decodeURIComponent(rss);
  const decodedSitemap = decodeURIComponent(sitemap);
  const published = sourcePosts.filter(
    (post) => post.status === 'published' && Date.parse(post.publishedAt) <= Date.now(),
  );
  const hidden = sourcePosts.filter(
    (post) => post.status !== 'published' || Date.parse(post.publishedAt) > Date.now(),
  );

  for (const post of published) {
    if (!index.includes(`/blog/${post.slug}/`)) throw new Error(`Published post missing from index: ${post.slug}`);
    if (!decodedRss.includes(`/blog/${post.slug}/`)) throw new Error(`Published post missing from RSS: ${post.slug}`);
    if (!decodedSitemap.includes(`/blog/${post.slug}/`)) throw new Error(`Published post missing from sitemap: ${post.slug}`);
    const detail = await fetch(`${server.origin}/blog/${encodeURIComponent(post.slug)}/`);
    if (!detail.ok) throw new Error(`Published detail failed (${detail.status}): ${post.slug}`);
  }

  for (const post of hidden) {
    if (index.includes(`/blog/${post.slug}/`)) throw new Error(`Hidden post appears in index: ${post.slug}`);
    if (decodedRss.includes(`/blog/${post.slug}/`)) throw new Error(`Hidden post appears in RSS: ${post.slug}`);
    if (decodedSitemap.includes(`/blog/${post.slug}/`)) throw new Error(`Hidden post appears in sitemap: ${post.slug}`);
    const detail = await fetch(`${server.origin}/blog/${encodeURIComponent(post.slug)}/`);
    if (detail.status !== 404) throw new Error(`Hidden detail must return 404: ${post.slug}`);
  }

  const database = openDatabase(databasePath);
  try {
    const repository = createPostRepository(database);
    repository.create({
      slug: '__runtime-immediate-update',
      title: 'Runtime immediate update fixture',
      description: 'This post must appear without rebuilding the image.',
      bodyMarkdown: '## Runtime fixture',
      category: '개발',
      status: 'published',
      heroImagePath: null,
      publishedAt: null,
    });
    const renamed = repository.create({
      slug: '한글-이전-주소',
      title: 'Runtime renamed slug fixture',
      description: 'The previous Korean slug must redirect to the new one.',
      bodyMarkdown: '## Runtime fixture',
      category: '개발',
      status: 'published',
      heroImagePath: null,
      publishedAt: null,
    });
    repository.update(renamed.id, renamed.version, { slug: '한글-새-주소' });
    repository.create({
      slug: '__runtime-kst-date',
      title: 'Runtime KST date fixture',
      description: 'Published at 05:30 KST, which is still the previous day in UTC.',
      bodyMarkdown: '## Runtime fixture',
      category: '개발',
      status: 'published',
      heroImagePath: null,
      publishedAt: '2026-01-01T20:30:00.000Z',
    });
  } finally {
    database.close();
  }

  const refreshedIndex = await (await fetch(`${server.origin}/blog/`)).text();
  const refreshedDetail = await fetch(`${server.origin}/blog/__runtime-immediate-update/`);
  if (!refreshedIndex.includes('/blog/__runtime-immediate-update/')) {
    throw new Error('A newly published database post did not appear without a rebuild');
  }
  if (!refreshedDetail.ok) throw new Error('A newly published database detail did not render');

  const historicalRedirect = await fetch(`${server.origin}/blog/${encodeURIComponent('한글-이전-주소')}/`, {
    redirect: 'manual',
  });
  const expectedLocation = `/blog/${encodeURIComponent('한글-새-주소')}/`;
  if (historicalRedirect.status !== 301 || historicalRedirect.headers.get('Location') !== expectedLocation) {
    throw new Error(
      `A renamed Korean slug must redirect permanently (${historicalRedirect.status} ${historicalRedirect.headers.get('Location')})`,
    );
  }

  const kstDetail = await (await fetch(`${server.origin}/blog/__runtime-kst-date/`)).text();
  if (!/<time datetime="2026-01-01T20:30:00.000Z">\s*2026년 1월 2일\s*<\/time>/.test(kstDetail)) {
    throw new Error('A post detail date must be rendered in Korea Standard Time');
  }
  const kstCard = refreshedIndex.match(/href="\/blog\/__runtime-kst-date\/"[\s\S]*?<\/a>/)?.[0] ?? '';
  if (!kstCard.includes('2026. 1. 2.')) {
    throw new Error('A blog index date must be rendered in Korea Standard Time');
  }

  console.log(
    `Runtime blog validation passed (${published.length} published, ${hidden.length} hidden, immediate DB update, slug redirect, and KST dates verified)`,
  );
} finally {
  await server.stop();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
