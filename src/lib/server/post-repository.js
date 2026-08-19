import { randomUUID } from 'node:crypto';
import { withImmediateTransaction } from './database.js';

function snapshot(post) {
  return JSON.stringify({
    slug: post.slug,
    title: post.title,
    description: post.description,
    bodyMarkdown: post.bodyMarkdown,
    category: post.category,
    status: post.status,
    heroImagePath: post.heroImagePath,
    publishedAt: post.publishedAt,
    contentUpdatedAt: post.contentUpdatedAt,
  });
}

function mapPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    bodyMarkdown: row.body_markdown,
    category: row.category,
    status: row.status,
    heroImagePath: row.hero_image_path,
    heroMediaId: row.hero_media_id,
    publishedAt: row.published_at,
    contentUpdatedAt: row.content_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
    sourcePath: row.source_path,
    sourceChecksum: row.source_checksum,
  };
}

function assertImportedPost(post) {
  for (const field of ['slug', 'title', 'description', 'bodyMarkdown', 'category', 'status', 'sourcePath']) {
    if (typeof post[field] !== 'string') throw new TypeError(`Imported post ${field} must be a string`);
  }
  if (!['draft', 'published'].includes(post.status)) {
    throw new TypeError(`Unsupported post status: ${post.status}`);
  }
  if (!/^[a-f0-9]{64}$/.test(post.sourceChecksum)) {
    throw new TypeError(`Imported post sourceChecksum must be a SHA-256 digest: ${post.slug}`);
  }
}

export function createPostRepository(database, { idGenerator = randomUUID } = {}) {
  const findBySlugStatement = database.prepare('SELECT * FROM posts WHERE slug = ?');
  const listStatement = database.prepare('SELECT * FROM posts ORDER BY published_at DESC, slug');
  const insertStatement = database.prepare(`
    INSERT INTO posts (
      id, slug, title, description, body_markdown, category, status, hero_image_path,
      published_at, content_updated_at, created_at, updated_at, version, source_path,
      source_checksum
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
  `);
  const updateStatement = database.prepare(`
    UPDATE posts SET
      title = ?, description = ?, body_markdown = ?, category = ?, status = ?,
      hero_image_path = ?, published_at = ?, content_updated_at = ?, updated_at = ?,
      version = ?, source_path = ?, source_checksum = ?
    WHERE id = ?
  `);
  const insertRevisionStatement = database.prepare(`
    INSERT INTO post_revisions (post_id, version, snapshot_json, created_at)
    VALUES (?, ?, ?, ?)
  `);

  function insertRevision(post, createdAt) {
    insertRevisionStatement.run(post.id, post.version, snapshot(post), createdAt);
  }

  function upsertImportedPost(post) {
    assertImportedPost(post);
    const existing = mapPost(findBySlugStatement.get(post.slug));

    if (!existing) {
      const created = {
        ...post,
        id: idGenerator(),
        version: 1,
        createdAt: post.createdAt ?? post.publishedAt ?? new Date().toISOString(),
        updatedAt: post.updatedAt ?? post.contentUpdatedAt ?? post.publishedAt ?? new Date().toISOString(),
      };
      insertStatement.run(
        created.id,
        created.slug,
        created.title,
        created.description,
        created.bodyMarkdown,
        created.category,
        created.status,
        created.heroImagePath,
        created.publishedAt,
        created.contentUpdatedAt,
        created.createdAt,
        created.updatedAt,
        created.sourcePath,
        created.sourceChecksum,
      );
      insertRevision(created, created.updatedAt);
      return { action: 'created', post: created };
    }

    if (existing.sourcePath !== post.sourcePath) {
      throw new Error(
        `Cannot import ${post.sourcePath}: slug ${post.slug} belongs to ${existing.sourcePath ?? 'a database post'}`,
      );
    }
    if (existing.sourceChecksum === post.sourceChecksum) {
      return { action: 'unchanged', post: existing };
    }

    const updated = {
      ...existing,
      ...post,
      version: existing.version + 1,
      createdAt: existing.createdAt,
      updatedAt: post.updatedAt ?? post.contentUpdatedAt ?? new Date().toISOString(),
    };
    updateStatement.run(
      updated.title,
      updated.description,
      updated.bodyMarkdown,
      updated.category,
      updated.status,
      updated.heroImagePath,
      updated.publishedAt,
      updated.contentUpdatedAt,
      updated.updatedAt,
      updated.version,
      updated.sourcePath,
      updated.sourceChecksum,
      updated.id,
    );
    insertRevision(updated, updated.updatedAt);
    return { action: 'updated', post: updated };
  }

  return {
    findBySlug(slug) {
      return mapPost(findBySlugStatement.get(slug));
    },

    list() {
      return listStatement.all().map(mapPost);
    },

    importPosts(posts) {
      return withImmediateTransaction(database, () => {
        const results = posts.map(upsertImportedPost);
        return results.reduce(
          (summary, result) => ({ ...summary, [result.action]: summary[result.action] + 1 }),
          { created: 0, updated: 0, unchanged: 0 },
        );
      });
    },
  };
}
