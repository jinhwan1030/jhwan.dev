import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const contentDirectory = fileURLToPath(new URL('../src/content/blog/', import.meta.url));
const outputDirectory = fileURLToPath(new URL('../dist/', import.meta.url));
const fixtureSlug = '__draft-visibility-check';
const fixturePath = path.join(contentDirectory, `${fixtureSlug}.md`);

function collectMarkdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectMarkdownFiles(entryPath);
    return /\.mdx?$/.test(entry.name) ? [entryPath] : [];
  });
}

if (fs.existsSync(fixturePath)) {
  throw new Error(`Draft validation fixture already exists: ${fixturePath}`);
}

fs.writeFileSync(
  fixturePath,
  `---
title: Draft visibility validation fixture
description: This temporary entry must never appear in production output.
pubDate: 2000-01-01
category: 개발
draft: true
---
`,
);

try {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const build = spawnSync(npmCommand, ['run', 'build'], { stdio: 'inherit' });
  if (build.status !== 0) throw new Error(`Production build failed with status ${build.status}`);

  const blogIndex = fs.readFileSync(path.join(outputDirectory, 'blog/index.html'), 'utf8');
  const rss = fs.readFileSync(path.join(outputDirectory, 'rss.xml'), 'utf8');
  const draftSlugs = collectMarkdownFiles(contentDirectory)
    .filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      const frontmatter = source.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? '';
      return /^draft:\s*true\s*$/m.test(frontmatter);
    })
    .map((file) =>
      path
        .relative(contentDirectory, file)
        .replace(/\\/g, '/')
        .replace(/\.mdx?$/, ''),
    );

  for (const slug of draftSlugs) {
    const detailPage = path.join(outputDirectory, 'blog', slug, 'index.html');
    if (fs.existsSync(detailPage)) throw new Error(`Draft detail page was generated: ${slug}`);
    if (blogIndex.includes(`/blog/${slug}`)) throw new Error(`Draft appears in blog index: ${slug}`);
    if (rss.includes(`/blog/${slug}`)) throw new Error(`Draft appears in RSS: ${slug}`);
  }

  console.log(`Draft visibility validation passed (${draftSlugs.length} draft entries checked)`);
} finally {
  fs.rmSync(fixturePath, { force: true });
}
