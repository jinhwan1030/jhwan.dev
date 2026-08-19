import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

function fail(message) {
  throw new Error(`CMS config: ${message}`);
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${name} must be a non-empty string`);
  }
  return value;
}

function requirePublicFolder(value, name) {
  const folder = requireString(value, name);
  if (!folder.startsWith('/')) fail(`${name} must start with "/"`);
  if (/^https?:\/\//i.test(folder)) fail(`${name} must not be an absolute URL`);
  return folder;
}

function unquote(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === "'" || quote === '"') && trimmed.at(-1) === quote) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function valueAtIndent(lines, name, indent, start = 0, end = lines.length) {
  const prefix = `${' '.repeat(indent)}${name}:`;
  const line = lines.slice(start, end).find((candidate) => candidate.startsWith(prefix));
  return line === undefined ? undefined : unquote(line.slice(prefix.length));
}

function blockEnd(lines, start, indent) {
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const currentIndent = line.length - line.trimStart().length;
    if (currentIndent <= indent) return index;
  }
  return lines.length;
}

export function parseCmsConfig(source) {
  const lines = source.split(/\r?\n/);
  const backendStart = lines.findIndex((line) => line === 'backend:');
  const backendEnd = backendStart === -1 ? -1 : blockEnd(lines, backendStart, 0);
  const blogStart = lines.findIndex((line) => /^  - name:\s*['"]?blog['"]?\s*$/.test(line));
  const blogEnd =
    blogStart === -1
      ? -1
      : lines.findIndex((line, index) => index > blogStart && /^  - name:/.test(line));
  const effectiveBlogEnd = blogEnd === -1 ? lines.length : blogEnd;
  const authMethods = valueAtIndent(lines, 'auth_methods', 2, backendStart, backendEnd);
  const authScope = valueAtIndent(lines, 'auth_scope', 2, backendStart, backendEnd);
  const fieldNames = lines
    .slice(blogStart, effectiveBlogEnd)
    .filter((line) => line.startsWith('        name:'))
    .map((line) => unquote(line.slice('        name:'.length)));

  return {
    media_folder: valueAtIndent(lines, 'media_folder', 0),
    public_folder: valueAtIndent(lines, 'public_folder', 0),
    ...(valueAtIndent(lines, 'local_backend', 0) === undefined ? {} : { local_backend: true }),
    ...(valueAtIndent(lines, 'locale', 0) === undefined ? {} : { locale: true }),
    backend: {
      name: valueAtIndent(lines, 'name', 2, backendStart, backendEnd),
      base_url: valueAtIndent(lines, 'base_url', 2, backendStart, backendEnd),
      ...(authScope === undefined ? {} : { auth_scope: authScope }),
      auth_methods: authMethods
        ?.replace(/^\[/, '')
        .replace(/\]$/, '')
        .split(',')
        .map(unquote)
        .filter(Boolean),
    },
    collections:
      blogStart === -1
        ? []
        : [
            {
              name: 'blog',
              folder: valueAtIndent(lines, 'folder', 4, blogStart, effectiveBlogEnd),
              media_folder: valueAtIndent(
                lines,
                'media_folder',
                4,
                blogStart,
                effectiveBlogEnd,
              ),
              public_folder: valueAtIndent(
                lines,
                'public_folder',
                4,
                blogStart,
                effectiveBlogEnd,
              ),
              fields: fieldNames.map((name) => ({ name })),
            },
          ],
  };
}

export function validateCmsConfig(config, adminHtml) {
  requireString(config.media_folder, 'media_folder');
  requirePublicFolder(config.public_folder, 'public_folder');

  if ('local_backend' in config) fail('local_backend is not supported by Sveltia CMS');
  if ('locale' in config) fail('locale is ignored by Sveltia CMS');

  if (config.backend?.name !== 'github') fail('backend.name must be "github"');
  if (config.backend?.base_url !== 'https://auth.jhwan.dev') {
    fail('backend.base_url must use the jhwan.dev OAuth Worker');
  }
  if ('auth_scope' in config.backend) {
    fail('backend.auth_scope is ignored by the reviewed Sveltia CMS version');
  }
  if (config.backend?.auth_methods?.length !== 1 || config.backend.auth_methods[0] !== 'oauth') {
    fail('backend.auth_methods must allow OAuth only');
  }

  const blog = config.collections?.find((collection) => collection.name === 'blog');
  if (!blog) fail('blog collection is missing');

  const collectionMediaFolder = requireString(blog.media_folder, 'blog.media_folder');
  const collectionPublicFolder = requireString(blog.public_folder, 'blog.public_folder');
  const resolvedMediaFolder = path.posix.normalize(
    path.posix.join('/', requireString(blog.folder, 'blog.folder'), collectionMediaFolder),
  );

  if (resolvedMediaFolder !== config.media_folder) {
    fail(`blog.media_folder resolves to ${resolvedMediaFolder}, expected ${config.media_folder}`);
  }
  if (collectionPublicFolder !== collectionMediaFolder) {
    fail('blog.public_folder must match blog.media_folder for Astro image references');
  }

  for (const fieldName of [
    'title',
    'description',
    'pubDate',
    'heroImage',
    'category',
    'draft',
    'body',
  ]) {
    if (!blog.fields?.some((field) => field.name === fieldName)) {
      fail(`blog field "${fieldName}" is missing`);
    }
  }

  if (!adminHtml.includes('@sveltia/cms@0.172.4/dist/sveltia-cms.js')) {
    fail('admin/index.html must load the reviewed Sveltia CMS version');
  }
}

export function validateCmsFiles() {
  const configPath = new URL('../public/admin/config.yml', import.meta.url);
  const adminPath = new URL('../public/admin/index.html', import.meta.url);
  const config = parseCmsConfig(fs.readFileSync(configPath, 'utf8'));
  const adminHtml = fs.readFileSync(adminPath, 'utf8');

  validateCmsConfig(config, adminHtml);
  console.log('CMS configuration validation passed');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  validateCmsFiles();
}
