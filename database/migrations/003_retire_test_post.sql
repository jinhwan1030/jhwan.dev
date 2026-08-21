INSERT INTO post_revisions (post_id, version, snapshot_json, created_at)
SELECT
  id,
  version + 1,
  json_object(
    'slug', slug,
    'title', title,
    'description', description,
    'bodyMarkdown', body_markdown,
    'category', category,
    'status', status,
    'heroImagePath', hero_image_path,
    'publishedAt', published_at,
    'contentUpdatedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
    'deletedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM posts
WHERE slug = '게시글-작성페이지-테스트'
  AND deleted_at IS NULL;

UPDATE posts
SET
  deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  content_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  version = version + 1,
  source_path = NULL,
  source_checksum = NULL
WHERE slug = '게시글-작성페이지-테스트'
  AND deleted_at IS NULL;
