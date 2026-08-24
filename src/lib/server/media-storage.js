import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import { withImmediateTransaction } from './database.js';

export const MANAGED_MEDIA_KEY_PATTERN = /^[a-f0-9]{64}\.(?:avif|gif|jpg|png|webp)$/;
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
export const MAX_MEDIA_PIXELS = 40_000_000;

const MEDIA_TYPES = Object.freeze({
  avif: 'image/avif',
  gif: 'image/gif',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

const SHARP_FORMATS = Object.freeze({
  avif: 'avif',
  gif: 'gif',
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
});

export class ManagedMediaError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ManagedMediaError';
    this.status = status;
    this.code = code;
  }
}

function mediaRecord(row) {
  return {
    id: row.id,
    storageKey: row.storage_key,
    url: `/uploads/${row.storage_key}`,
    originalName: row.original_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    altText: row.alt_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeOriginalName(value) {
  const name = String(value ?? '').normalize('NFC').trim();
  if (!name || name.length > 255 || /[\u0000-\u001f\u007f/\\]/.test(name)) {
    throw new ManagedMediaError(400, 'invalid_media_name', '이미지 파일 이름이 올바르지 않습니다.');
  }
  return name;
}

function normalizeAltText(value) {
  const altText = String(value ?? '').normalize('NFC').trim();
  if (altText.length > 500) {
    throw new ManagedMediaError(400, 'invalid_alt_text', '대체 텍스트는 500자 이하여야 합니다.');
  }
  return altText;
}

function assertMediaRoot(mediaRoot) {
  fs.mkdirSync(mediaRoot, { recursive: true, mode: 0o750 });
  const stat = fs.lstatSync(mediaRoot);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Managed media root must be a real directory: ${mediaRoot}`);
  }
}

function verifyStoredFile(filePath, checksum) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`Managed media target must be a regular file: ${filePath}`);
  }
  const actual = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  if (actual !== checksum) throw new Error(`Managed media checksum conflict: ${filePath}`);
}

function promoteMediaFile(mediaRoot, storageKey, contents, checksum) {
  const target = path.join(mediaRoot, storageKey);
  if (fs.existsSync(target)) {
    verifyStoredFile(target, checksum);
    return false;
  }

  const temporary = path.join(mediaRoot, `.upload-${randomUUID()}`);
  try {
    fs.writeFileSync(temporary, contents, { flag: 'wx', mode: 0o600 });
    try {
      fs.linkSync(temporary, target);
      fs.chmodSync(target, 0o644);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      verifyStoredFile(target, checksum);
      return false;
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

async function inspectImage(contents, declaredMimeType) {
  let metadata;
  try {
    metadata = await sharp(contents, {
      animated: false,
      failOn: 'error',
      limitInputPixels: MAX_MEDIA_PIXELS,
    }).metadata();
  } catch {
    throw new ManagedMediaError(415, 'invalid_media', '지원하는 정상 이미지 파일만 업로드할 수 있습니다.');
  }

  let extension = SHARP_FORMATS[metadata.format];
  if (metadata.format === 'heif' && declaredMimeType === 'image/avif') extension = 'avif';
  if (!extension || !metadata.width || !metadata.height) {
    throw new ManagedMediaError(415, 'unsupported_media', 'JPEG, PNG, WebP, GIF, AVIF 이미지만 지원합니다.');
  }
  if (metadata.width * metadata.height > MAX_MEDIA_PIXELS) {
    throw new ManagedMediaError(413, 'media_dimensions_too_large', '이미지 해상도가 너무 큽니다.');
  }
  const mimeType = MEDIA_TYPES[extension];
  if (declaredMimeType && declaredMimeType !== mimeType) {
    throw new ManagedMediaError(415, 'media_type_mismatch', '파일 내용과 이미지 형식이 일치하지 않습니다.');
  }
  return { extension, mimeType, width: metadata.width, height: metadata.height };
}

export function resolveMediaRoot(mediaRoot = process.env.JHWAN_MEDIA_PATH) {
  const configured = mediaRoot?.trim();
  return path.resolve(configured || '.data/uploads');
}

export function mediaTypeForKey(storageKey) {
  if (!MANAGED_MEDIA_KEY_PATTERN.test(storageKey)) return null;
  return MEDIA_TYPES[path.extname(storageKey).slice(1)] ?? null;
}

export async function storeManagedMedia(
  database,
  { contents, originalName, declaredMimeType = '', altText = '', mediaRoot } = {},
) {
  const buffer = Buffer.isBuffer(contents) ? contents : Buffer.from(contents ?? []);
  if (buffer.length === 0) {
    throw new ManagedMediaError(400, 'empty_media', '빈 이미지 파일은 업로드할 수 없습니다.');
  }
  if (buffer.length > MAX_MEDIA_BYTES) {
    throw new ManagedMediaError(413, 'media_too_large', '이미지는 25 MiB 이하여야 합니다.');
  }

  const safeName = normalizeOriginalName(originalName);
  const safeAltText = normalizeAltText(altText);
  const image = await inspectImage(buffer, declaredMimeType);
  const checksum = createHash('sha256').update(buffer).digest('hex');
  const storageKey = `${checksum}.${image.extension}`;
  const resolvedRoot = resolveMediaRoot(mediaRoot);
  assertMediaRoot(resolvedRoot);

  const find = database.prepare('SELECT * FROM media WHERE id = ?');
  let existing;
  let createdFile = false;
  try {
    withImmediateTransaction(database, () => {
      existing = find.get(checksum);
      if (existing) {
        if (
          existing.storage_key !== storageKey
          || existing.mime_type !== image.mimeType
          || existing.byte_size !== buffer.length
        ) throw new Error(`Managed media metadata conflict: ${storageKey}`);
        promoteMediaFile(resolvedRoot, storageKey, buffer, checksum);
        return;
      }

      createdFile = promoteMediaFile(resolvedRoot, storageKey, buffer, checksum);
      const timestamp = new Date().toISOString();
      database.prepare(`
        INSERT INTO media (
          id, storage_key, original_name, mime_type, byte_size, width, height,
          alt_text, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        checksum,
        storageKey,
        safeName,
        image.mimeType,
        buffer.length,
        image.width,
        image.height,
        safeAltText,
        timestamp,
        timestamp,
      );
    });
    if (existing) return { ...mediaRecord(existing), deduplicated: true };
    return { ...mediaRecord(find.get(checksum)), deduplicated: false };
  } catch (error) {
    if (createdFile) fs.rmSync(path.join(resolvedRoot, storageKey), { force: true });
    throw error;
  }
}

export async function createManagedMediaResponse(
  storageKey,
  { mediaRoot, method = 'GET', ifNoneMatch = null } = {},
) {
  const mimeType = mediaTypeForKey(storageKey);
  if (!mimeType) return new Response('Not found', { status: 404 });

  const root = resolveMediaRoot(mediaRoot);
  let rootRealPath;
  let fileRealPath;
  let stat;
  try {
    rootRealPath = await fs.promises.realpath(root);
    fileRealPath = await fs.promises.realpath(path.join(root, storageKey));
    const prefix = `${rootRealPath}${path.sep}`;
    if (!fileRealPath.startsWith(prefix)) return new Response('Not found', { status: 404 });
    stat = await fs.promises.stat(fileRealPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return new Response('Not found', { status: 404 });
    throw error;
  }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });

  const checksum = storageKey.slice(0, 64);
  const etag = `"${checksum}"`;
  const headers = {
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Content-Length': String(stat.size),
    'Content-Type': mimeType,
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
  };
  if (ifNoneMatch === etag) return new Response(null, { status: 304, headers });
  if (method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(await fs.promises.readFile(fileRealPath), { status: 200, headers });
}
