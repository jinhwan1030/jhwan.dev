CREATE TABLE posts (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  slug TEXT NOT NULL UNIQUE CHECK (length(trim(slug)) > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '개발' CHECK (length(trim(category)) > 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  hero_image_path TEXT,
  hero_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  published_at TEXT,
  content_updated_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  source_path TEXT UNIQUE,
  source_checksum TEXT
) STRICT;

CREATE TABLE media (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  storage_key TEXT NOT NULL UNIQUE CHECK (length(trim(storage_key)) > 0),
  original_name TEXT NOT NULL CHECK (length(trim(original_name)) > 0),
  mime_type TEXT NOT NULL CHECK (length(trim(mime_type)) > 0),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  width INTEGER CHECK (width IS NULL OR width > 0),
  height INTEGER CHECK (height IS NULL OR height > 0),
  alt_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE post_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version >= 1),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  created_at TEXT NOT NULL,
  UNIQUE (post_id, version)
) STRICT;

CREATE INDEX posts_publication_idx
  ON posts (status, published_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX post_revisions_post_idx
  ON post_revisions (post_id, version DESC);
