import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { loadMarkdownPostSources, summarizeMarkdownPosts } from './markdown-posts.mjs';
import { openDatabase, verifyDatabase, withImmediateTransaction } from '../../src/lib/server/database.js';
import { migrateDatabase } from '../../src/lib/server/migrations.js';
import { createPostRepository } from '../../src/lib/server/post-repository.js';

const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const IMAGE_FORMATS = Object.freeze({
  avif: { extension: 'avif', mimeType: 'image/avif' },
  gif: { extension: 'gif', mimeType: 'image/gif' },
  jpeg: { extension: 'jpg', mimeType: 'image/jpeg' },
  png: { extension: 'png', mimeType: 'image/png' },
  webp: { extension: 'webp', mimeType: 'image/webp' },
});
const MARKDOWN_URL_PATTERN = /(!?\[[^\]\n]*\]\(\s*<?)([^\s)>]+)(>?[^)\n]*\))/g;
const HTML_IMAGE_URL_PATTERN = /(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])/gi;

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function collectMediaFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in legacy media: ${entryPath}`);
    if (entry.isDirectory()) return collectMediaFiles(entryPath);
    if (!entry.isFile() || entry.name.startsWith('.')) return [];
    return [entryPath];
  }).sort((left, right) => left.localeCompare(right));
}

function assertSourceDirectory(directory, label) {
  let stat;
  try {
    stat = fs.lstatSync(directory);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`${label} does not exist: ${directory}`);
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${directory}`);
  }
}

async function inspectMedia(filePath, mediaSource) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_MEDIA_BYTES) throw new Error(`Legacy media exceeds 25 MiB: ${filePath}`);
  const buffer = fs.readFileSync(filePath);
  const checksum = createHash('sha256').update(buffer).digest('hex');
  const metadata = await sharp(buffer, { animated: true, limitInputPixels: 40_000_000 }).metadata();
  const format = IMAGE_FORMATS[metadata.format];
  if (!format) throw new Error(`Unsupported legacy media format: ${filePath}`);
  if (!metadata.width || !metadata.height) throw new Error(`Legacy media dimensions are unavailable: ${filePath}`);
  const storageKey = `${checksum}.${format.extension}`;
  return {
    id: checksum,
    sourcePath: filePath,
    relativePath: path.relative(mediaSource, filePath).split(path.sep).join('/'),
    storageKey,
    publicPath: `/uploads/${storageKey}`,
    originalName: path.basename(filePath),
    mimeType: format.mimeType,
    byteSize: stat.size,
    width: metadata.width,
    height: metadata.height,
    checksum,
  };
}

function referencePath(value) {
  const withoutSuffix = value.split(/[?#]/, 1)[0];
  try {
    return decodeURIComponent(withoutSuffix);
  } catch {
    throw new Error(`Invalid percent-encoding in legacy media reference: ${value}`);
  }
}

function resolveReference(value, postFilePath, { projectRoot, mediaSource, mediaByPath }) {
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(value) || value.startsWith('//')) return null;
  const decoded = referencePath(value);
  const candidate = decoded.startsWith('/')
    ? path.resolve(projectRoot, `.${decoded}`)
    : path.resolve(path.dirname(postFilePath), decoded);
  if (!isInside(mediaSource, candidate)) return null;
  const media = mediaByPath.get(candidate);
  if (!media) throw new Error(`Managed legacy media reference does not exist: ${value} in ${postFilePath}`);
  return media;
}

function rewriteBody(body, postFilePath, context, referencedMedia) {
  const replace = (match, prefix, value, suffix) => {
    const media = resolveReference(value, postFilePath, context);
    if (!media) return match;
    referencedMedia.add(media.id);
    return `${prefix}${media.publicPath}${suffix}`;
  };
  return body
    .replace(MARKDOWN_URL_PATTERN, replace)
    .replace(HTML_IMAGE_URL_PATTERN, replace);
}

function migrationChecksum(post) {
  return createHash('sha256')
    .update(post.sourceChecksum)
    .update('\0')
    .update(post.bodyMarkdown)
    .update('\0')
    .update(post.heroImagePath ?? '')
    .digest('hex');
}

export async function analyzeLegacyContent({
  projectRoot = process.cwd(),
  contentDirectory = path.join(projectRoot, 'src/content/blog'),
  mediaSource = path.join(projectRoot, 'src/assets/blog'),
} = {}) {
  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedContent = path.resolve(contentDirectory);
  const resolvedMediaSource = path.resolve(mediaSource);
  if (!isInside(resolvedProjectRoot, resolvedContent) || !isInside(resolvedProjectRoot, resolvedMediaSource)) {
    throw new Error('Legacy content and media sources must stay inside the project root');
  }
  assertSourceDirectory(resolvedContent, 'Legacy content source');
  assertSourceDirectory(resolvedMediaSource, 'Legacy media source');

  const inspectedMedia = await Promise.all(
    collectMediaFiles(resolvedMediaSource).map((filePath) => inspectMedia(filePath, resolvedMediaSource)),
  );
  const mediaById = new Map();
  for (const item of inspectedMedia) {
    const canonical = mediaById.get(item.id);
    if (canonical && canonical.storageKey !== item.storageKey) {
      throw new Error(`Legacy media checksum maps to conflicting formats: ${item.relativePath}`);
    }
    if (!canonical) mediaById.set(item.id, item);
  }
  const media = [...mediaById.values()];
  const mediaByPath = new Map(
    inspectedMedia.map((item) => [path.resolve(item.sourcePath), mediaById.get(item.id)]),
  );
  const referencedMedia = new Set();
  const postSources = loadMarkdownPostSources(resolvedContent);
  const posts = postSources.map(({ filePath, post }) => {
    const heroMedia = post.heroImagePath
      ? resolveReference(post.heroImagePath, filePath, {
          projectRoot: resolvedProjectRoot,
          mediaSource: resolvedMediaSource,
          mediaByPath,
        })
      : null;
    if (heroMedia) referencedMedia.add(heroMedia.id);
    const migrated = {
      ...post,
      bodyMarkdown: rewriteBody(post.bodyMarkdown, filePath, {
        projectRoot: resolvedProjectRoot,
        mediaSource: resolvedMediaSource,
        mediaByPath,
      }, referencedMedia),
      heroImagePath: heroMedia?.publicPath ?? post.heroImagePath,
      heroMediaId: heroMedia?.id ?? null,
    };
    migrated.sourceChecksum = migrationChecksum(migrated);
    return migrated;
  });

  return {
    posts,
    media,
    summary: {
      content: summarizeMarkdownPosts(posts),
      media: {
        total: inspectedMedia.length,
        unique: media.length,
        referenced: referencedMedia.size,
        unreferenced: media.length - referencedMedia.size,
        bytes: inspectedMedia.reduce((total, item) => total + item.byteSize, 0),
      },
    },
  };
}

function importMedia(database, media, timestamp) {
  const find = database.prepare('SELECT * FROM media WHERE id = ?');
  const insert = database.prepare(`
    INSERT INTO media (
      id, storage_key, original_name, mime_type, byte_size, width, height, alt_text, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)
  `);
  const summary = { created: 0, unchanged: 0 };
  for (const item of media) {
    const existing = find.get(item.id);
    if (existing) {
      if (
        existing.storage_key !== item.storageKey
        || existing.mime_type !== item.mimeType
        || existing.byte_size !== item.byteSize
      ) throw new Error(`Legacy media metadata conflict: ${item.relativePath}`);
      summary.unchanged += 1;
      continue;
    }
    insert.run(
      item.id,
      item.storageKey,
      item.originalName,
      item.mimeType,
      item.byteSize,
      item.width,
      item.height,
      timestamp,
      timestamp,
    );
    summary.created += 1;
  }
  return summary;
}

function promoteMediaFiles(media, destination) {
  fs.mkdirSync(destination, { recursive: true });
  const staging = path.join(destination, `.legacy-import-${randomUUID()}`);
  fs.mkdirSync(staging, { mode: 0o700 });
  const created = [];
  try {
    for (const item of media) {
      const target = path.join(destination, item.storageKey);
      if (fs.existsSync(target)) {
        const existingChecksum = createHash('sha256').update(fs.readFileSync(target)).digest('hex');
        if (existingChecksum !== item.checksum) throw new Error(`Managed media checksum conflict: ${target}`);
        continue;
      }
      const staged = path.join(staging, item.storageKey);
      fs.copyFileSync(item.sourcePath, staged, fs.constants.COPYFILE_EXCL);
      const stagedChecksum = createHash('sha256').update(fs.readFileSync(staged)).digest('hex');
      if (stagedChecksum !== item.checksum) {
        throw new Error(`Legacy media changed after analysis: ${item.sourcePath}`);
      }
      fs.chmodSync(staged, 0o644);
      fs.renameSync(staged, target);
      created.push(target);
    }
    return created;
  } catch (error) {
    removeCreatedMedia(created);
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function removeCreatedMedia(files) {
  for (const filePath of files.reverse()) fs.rmSync(filePath, { force: true });
}

export function importAnalyzedLegacyContent(
  analysis,
  { databasePath = ':memory:', mediaDestination, apply = false, clock = () => Date.now() } = {},
) {
  if (apply && !mediaDestination) throw new Error('Applying legacy migration requires mediaDestination');
  const destination = mediaDestination ? path.resolve(mediaDestination) : null;
  const database = openDatabase(databasePath);
  let createdFiles = [];
  try {
    const migration = migrateDatabase(database);
    if (apply) createdFiles = promoteMediaFiles(analysis.media, destination);
    const timestamp = new Date(clock()).toISOString();
    const repository = createPostRepository(database, { clock });
    const imported = withImmediateTransaction(database, () => {
      const media = importMedia(database, analysis.media, timestamp);
      const posts = repository.importPosts(analysis.posts, { withinTransaction: true });
      return { posts, media };
    });
    const verification = verifyDatabase(database);
    return {
      mode: apply ? 'apply' : 'dry-run',
      database: apply ? path.resolve(databasePath) : ':memory:',
      mediaDestination: apply ? destination : null,
      summary: analysis.summary,
      migration,
      imported,
      verification,
      copiedMedia: createdFiles.length,
    };
  } catch (error) {
    removeCreatedMedia(createdFiles);
    throw error;
  } finally {
    database.close();
  }
}
