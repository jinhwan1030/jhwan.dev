import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CORE_SCHEMA, load } from 'js-yaml';

const FRONTMATTER_PATTERN = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function collectMarkdownFiles(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectMarkdownFiles(entryPath);
      return /\.mdx?$/.test(entry.name) ? [entryPath] : [];
    })
    .sort((left, right) => left.localeCompare(right));
}

function requiredString(value, field, sourcePath) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${sourcePath}: ${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(value, field, sourcePath) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new Error(`${sourcePath}: ${field} must be a string`);
  return value.trim() || null;
}

function isoDate(value, field, sourcePath, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return null;
    throw new Error(`${sourcePath}: ${field} is required`);
  }

  const source = value instanceof Date ? value.toISOString() : String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(source) ? `${source}T00:00:00.000Z` : source;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${sourcePath}: ${field} is not a valid date`);
  return parsed.toISOString();
}

function slugFromRelativePath(relativePath) {
  const slug = relativePath.replace(/\\/g, '/').replace(/\.mdx?$/, '').normalize('NFC');
  const segments = slug.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Invalid content slug derived from ${relativePath}`);
  }
  return slug;
}

export function parseMarkdownPost(filePath, { contentDirectory, sourcePrefix = 'src/content/blog' }) {
  const source = fs.readFileSync(filePath, 'utf8');
  const match = source.match(FRONTMATTER_PATTERN);
  const relativePath = path.relative(contentDirectory, filePath).replace(/\\/g, '/');
  const sourcePath = path.posix.join(sourcePrefix, relativePath);
  if (!match) throw new Error(`${sourcePath}: missing YAML frontmatter`);

  const data = load(match[1], { schema: CORE_SCHEMA }) ?? {};
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${sourcePath}: frontmatter must be a mapping`);
  }
  if (typeof data.draft !== 'boolean') throw new Error(`${sourcePath}: draft must be true or false`);

  const publishedAt = isoDate(data.pubDate, 'pubDate', sourcePath);
  const contentUpdatedAt = isoDate(data.updatedDate, 'updatedDate', sourcePath, { optional: true });

  return {
    slug: slugFromRelativePath(relativePath),
    title: requiredString(data.title, 'title', sourcePath),
    description: requiredString(data.description, 'description', sourcePath),
    bodyMarkdown: source.slice(match[0].length),
    category: requiredString(data.category ?? '개발', 'category', sourcePath),
    status: data.draft ? 'draft' : 'published',
    heroImagePath: optionalString(data.heroImage, 'heroImage', sourcePath),
    publishedAt,
    contentUpdatedAt,
    createdAt: publishedAt,
    updatedAt: contentUpdatedAt ?? publishedAt,
    sourcePath,
    sourceChecksum: createHash('sha256').update(source).digest('hex'),
  };
}

export function loadMarkdownPosts(contentDirectory, options = {}) {
  const resolvedDirectory = path.resolve(contentDirectory);
  return collectMarkdownFiles(resolvedDirectory).map((filePath) =>
    parseMarkdownPost(filePath, { contentDirectory: resolvedDirectory, ...options }),
  );
}

export function summarizeMarkdownPosts(posts) {
  return posts.reduce(
    (summary, post) => ({
      total: summary.total + 1,
      published: summary.published + (post.status === 'published' ? 1 : 0),
      draft: summary.draft + (post.status === 'draft' ? 1 : 0),
    }),
    { total: 0, published: 0, draft: 0 },
  );
}
