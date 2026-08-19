#!/bin/sh

set -eu

database_path="${JHWAN_DATABASE_PATH:-/app/.data/jhwan.db}"
media_path="${JHWAN_MEDIA_PATH:-/app/.data/uploads}"
data_directory="$(dirname -- "$database_path")"
migration_marker="$data_directory/.legacy-migration-complete"

mkdir -p -- "$data_directory" "$media_path"

if [ ! -f "$migration_marker" ]; then
  echo "→ 기존 콘텐츠와 미디어를 영구 저장소로 이전합니다."
  node ./scripts/migrate-legacy-content.mjs \
    --apply \
    --database "$database_path" \
    --uploads "$media_path"
  temporary_marker="$migration_marker.tmp.$$"
  printf 'completed_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$temporary_marker"
  mv -- "$temporary_marker" "$migration_marker"
  echo "✓ 기존 콘텐츠와 미디어 이전 완료"
fi

exec "$@"
