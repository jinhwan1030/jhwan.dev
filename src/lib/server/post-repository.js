import { randomUUID } from 'node:crypto';
import { withImmediateTransaction } from './database.js';

export class PostNotFoundError extends Error {
  constructor(id) {
    super(`Post not found: ${id}`);
    this.name = 'PostNotFoundError';
  }
}

export class PostVersionConflictError extends Error {
  constructor(id, expectedVersion, actualVersion) {
    super(`Post ${id} version conflict: expected ${expectedVersion}, actual ${actualVersion}`);
    this.name = 'PostVersionConflictError';
    this.actualVersion = actualVersion;
  }
}

export class PostSlugConflictError extends Error {
  constructor(slug) {
    super(`Post slug is already reserved: ${slug}`);
    this.name = 'PostSlugConflictError';
    this.slug = slug;
  }
}

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
    deletedAt: post.deletedAt,
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

export function createPostRepository(
  database,
  { idGenerator = randomUUID, clock = () => Date.now() } = {},
) {
  const findByIdStatement = database.prepare('SELECT * FROM posts WHERE id = ?');
  const findBySlugStatement = database.prepare('SELECT * FROM posts WHERE slug = ?');
  const findSlugHistoryStatement = database.prepare(
    'SELECT post_id FROM post_slug_history WHERE slug = ?',
  );
  const listActiveStatement = database.prepare(
    'SELECT * FROM posts WHERE deleted_at IS NULL ORDER BY published_at DESC, slug',
  );
  const listAllStatement = database.prepare(
    'SELECT * FROM posts ORDER BY deleted_at IS NOT NULL, published_at DESC, slug',
  );
  const listPublishedStatement = database.prepare(`
    SELECT * FROM posts
    WHERE status = 'published'
      AND deleted_at IS NULL
      AND published_at IS NOT NULL
      AND published_at <= ?
    ORDER BY published_at DESC, slug
  `);
  const findPublishedBySlugStatement = database.prepare(`
    SELECT * FROM posts
    WHERE slug = ?
      AND status = 'published'
      AND deleted_at IS NULL
      AND published_at IS NOT NULL
      AND published_at <= ?
  `);
  const insertStatement = database.prepare(`
    INSERT INTO posts (
      id, slug, title, description, body_markdown, category, status, hero_image_path,
      published_at, content_updated_at, created_at, updated_at, deleted_at, version,
      source_path, source_checksum
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const updateStatement = database.prepare(`
    UPDATE posts SET
      slug = ?, title = ?, description = ?, body_markdown = ?, category = ?, status = ?,
      hero_image_path = ?, published_at = ?, content_updated_at = ?, updated_at = ?,
      deleted_at = ?, version = ?, source_path = ?, source_checksum = ?
    WHERE id = ?
  `);
  const insertRevisionStatement = database.prepare(`
    INSERT INTO post_revisions (post_id, version, snapshot_json, created_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertSlugHistoryStatement = database.prepare(
    'INSERT INTO post_slug_history (post_id, slug, created_at) VALUES (?, ?, ?)',
  );
  const listRevisionsStatement = database.prepare(`
    SELECT id, post_id, version, snapshot_json, created_at
    FROM post_revisions WHERE post_id = ? ORDER BY version DESC
  `);

  const nowIso = () => new Date(clock()).toISOString();

  function insertRevision(post, createdAt) {
    insertRevisionStatement.run(post.id, post.version, snapshot(post), createdAt);
  }

  function insertPost(post) {
    insertStatement.run(
      post.id,
      post.slug,
      post.title,
      post.description,
      post.bodyMarkdown,
      post.category,
      post.status,
      post.heroImagePath,
      post.publishedAt,
      post.contentUpdatedAt,
      post.createdAt,
      post.updatedAt,
      post.deletedAt,
      post.version,
      post.sourcePath,
      post.sourceChecksum,
    );
  }

  function updatePost(post) {
    updateStatement.run(
      post.slug,
      post.title,
      post.description,
      post.bodyMarkdown,
      post.category,
      post.status,
      post.heroImagePath,
      post.publishedAt,
      post.contentUpdatedAt,
      post.updatedAt,
      post.deletedAt,
      post.version,
      post.sourcePath,
      post.sourceChecksum,
      post.id,
    );
  }

  function assertVersion(post, expectedVersion) {
    if (post.version !== expectedVersion) {
      throw new PostVersionConflictError(post.id, expectedVersion, post.version);
    }
  }

  function assertSlugAvailable(slug, currentPostId = null) {
    const current = mapPost(findBySlugStatement.get(slug));
    const historical = findSlugHistoryStatement.get(slug);
    if ((current && current.id !== currentPostId) || historical) {
      throw new PostSlugConflictError(slug);
    }
  }

  function upsertImportedPost(post) {
    assertImportedPost(post);
    const existing = mapPost(findBySlugStatement.get(post.slug));

    if (!existing) {
      assertSlugAvailable(post.slug);
      const created = {
        ...post,
        id: idGenerator(),
        version: 1,
        deletedAt: null,
        createdAt: post.createdAt ?? post.publishedAt ?? nowIso(),
        updatedAt: post.updatedAt ?? post.contentUpdatedAt ?? post.publishedAt ?? nowIso(),
      };
      insertPost(created);
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
      updatedAt: post.updatedAt ?? post.contentUpdatedAt ?? nowIso(),
    };
    updatePost(updated);
    insertRevision(updated, updated.updatedAt);
    return { action: 'updated', post: updated };
  }

  return {
    findById(id) {
      return mapPost(findByIdStatement.get(id));
    },

    findBySlug(slug) {
      return mapPost(findBySlugStatement.get(slug));
    },

    resolveHistoricalSlug(slug) {
      const history = findSlugHistoryStatement.get(slug);
      return history ? mapPost(findByIdStatement.get(history.post_id)) : null;
    },

    list({ includeDeleted = false } = {}) {
      return (includeDeleted ? listAllStatement : listActiveStatement).all().map(mapPost);
    },

    listPublished(now = new Date().toISOString()) {
      return listPublishedStatement.all(now).map(mapPost);
    },

    findPublishedBySlug(slug, now = new Date().toISOString()) {
      return mapPost(findPublishedBySlugStatement.get(slug, now));
    },

    listRevisions(id) {
      return listRevisionsStatement.all(id).map((row) => ({
        id: row.id,
        postId: row.post_id,
        version: row.version,
        snapshot: JSON.parse(row.snapshot_json),
        createdAt: row.created_at,
      }));
    },

    create(input) {
      return withImmediateTransaction(database, () => {
        assertSlugAvailable(input.slug);
        const timestamp = nowIso();
        const post = {
          ...input,
          id: idGenerator(),
          heroImagePath: input.heroImagePath ?? null,
          heroMediaId: null,
          publishedAt:
            input.status === 'published'
              ? (input.publishedAt ?? timestamp)
              : (input.publishedAt ?? null),
          contentUpdatedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
          version: 1,
          sourcePath: null,
          sourceChecksum: null,
        };
        insertPost(post);
        insertRevision(post, timestamp);
        return post;
      });
    },

    update(id, expectedVersion, patch) {
      return withImmediateTransaction(database, () => {
        const existing = mapPost(findByIdStatement.get(id));
        if (!existing || existing.deletedAt) throw new PostNotFoundError(id);
        assertVersion(existing, expectedVersion);

        const timestamp = nowIso();
        const updated = {
          ...existing,
          ...patch,
          version: existing.version + 1,
          updatedAt: timestamp,
          contentUpdatedAt: timestamp,
          sourcePath: null,
          sourceChecksum: null,
        };
        if (updated.status === 'published' && !updated.publishedAt) updated.publishedAt = timestamp;

        if (updated.slug !== existing.slug) {
          assertSlugAvailable(updated.slug, existing.id);
          insertSlugHistoryStatement.run(existing.id, existing.slug, timestamp);
        }

        updatePost(updated);
        insertRevision(updated, timestamp);
        return updated;
      });
    },

    softDelete(id, expectedVersion) {
      return withImmediateTransaction(database, () => {
        const existing = mapPost(findByIdStatement.get(id));
        if (!existing || existing.deletedAt) throw new PostNotFoundError(id);
        assertVersion(existing, expectedVersion);
        const timestamp = nowIso();
        const deleted = {
          ...existing,
          deletedAt: timestamp,
          updatedAt: timestamp,
          contentUpdatedAt: timestamp,
          version: existing.version + 1,
          sourcePath: null,
          sourceChecksum: null,
        };
        updatePost(deleted);
        insertRevision(deleted, timestamp);
        return deleted;
      });
    },

    restore(id, expectedVersion) {
      return withImmediateTransaction(database, () => {
        const existing = mapPost(findByIdStatement.get(id));
        if (!existing || !existing.deletedAt) throw new PostNotFoundError(id);
        assertVersion(existing, expectedVersion);
        const timestamp = nowIso();
        const restored = {
          ...existing,
          deletedAt: null,
          updatedAt: timestamp,
          contentUpdatedAt: timestamp,
          version: existing.version + 1,
        };
        updatePost(restored);
        insertRevision(restored, timestamp);
        return restored;
      });
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
