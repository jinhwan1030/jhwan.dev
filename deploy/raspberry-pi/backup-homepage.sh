#!/usr/bin/env bash

set -Eeuo pipefail

HOMEPAGE_DIR="${JHWAN_HOMEPAGE_DIR:-$HOME/projects/jhwan-homepage}"
DATA_DIR="${JHWAN_HOMEPAGE_DATA_DIR:-$HOMEPAGE_DIR/data}"
BACKUP_ROOT="${JHWAN_HOMEPAGE_BACKUP_ROOT:-$HOME/backups/jhwan-homepage}"
RETENTION="${JHWAN_HOMEPAGE_BACKUP_RETENTION:-14}"
LOCK_FILE="${JHWAN_HOMEPAGE_BACKUP_LOCK:-/run/lock/jhwan-homepage-backup.lock}"
CONTAINER_NAME="${JHWAN_HOMEPAGE_CONTAINER:-jhwan-homepage}"

log() {
  printf '[%s] %s\n' "$(date --iso-8601=seconds)" "$*"
}

fail() {
  log "$*" >&2
  exit 1
}

for command_name in docker flock realpath sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || fail "필수 명령을 찾을 수 없습니다: $command_name"
done
[[ "$RETENTION" =~ ^[1-9][0-9]*$ ]] || fail "백업 보존 개수는 양의 정수여야 합니다."
[[ -d "$DATA_DIR" && ! -L "$DATA_DIR" ]] || fail "일반 데이터 디렉터리가 없습니다: $DATA_DIR"
[[ -f "$DATA_DIR/jhwan.db" && ! -L "$DATA_DIR/jhwan.db" ]] || fail "운영 DB가 없습니다: $DATA_DIR/jhwan.db"
[[ -d "$DATA_DIR/uploads" && ! -L "$DATA_DIR/uploads" ]] || fail "업로드 디렉터리가 없습니다: $DATA_DIR/uploads"

install -d -m 0700 -- "$BACKUP_ROOT"
backup_root_real="$(realpath -e -- "$BACKUP_ROOT")"
data_dir_real="$(realpath -e -- "$DATA_DIR")"
[[ "$backup_root_real" != "$data_dir_real" ]] || fail "백업 경로와 운영 데이터 경로가 같을 수 없습니다."

if [[ "${JHWAN_HOMEPAGE_BACKUP_SKIP_LOCK:-false}" != "true" ]]; then
  exec 9>"$LOCK_FILE"
  if ! flock --nonblock 9; then
    log "다른 홈페이지 백업 또는 복구가 실행 중이므로 건너뜁니다."
    exit 0
  fi
fi

container_id="$(docker container inspect --format '{{.Id}}' "$CONTAINER_NAME" 2>/dev/null || true)"
[[ -n "$container_id" ]] || fail "홈페이지 컨테이너를 찾을 수 없습니다: $CONTAINER_NAME"
image_id="$(docker container inspect --format '{{.Image}}' "$CONTAINER_NAME")"
[[ -n "$image_id" ]] || fail "홈페이지 이미지 ID를 확인할 수 없습니다."

stamp="$(date +%Y%m%d-%H%M%S)"
staging="$DATA_DIR/.backup-stage-$stamp-$$"
partial="$BACKUP_ROOT/.$stamp.partial"
final="$BACKUP_ROOT/$stamp"
[[ ! -e "$partial" && ! -e "$final" ]] || fail "같은 timestamp의 백업이 이미 있습니다: $stamp"

cleanup() {
  rm -rf -- "$staging" "$partial"
}
trap cleanup EXIT

install -d -m 0700 -- "$staging" "$partial" "$partial/uploads"
log "SQLite 온라인 백업을 생성합니다."
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --volume "$DATA_DIR:/data" \
  --entrypoint node \
  "$image_id" \
  ./scripts/backup-content-database.mjs \
  --source /data/jhwan.db \
  --destination "/data/${staging##*/}/jhwan.db" \
  >"$partial/database-backup.json"

cp --reflink=auto -- "$staging/jhwan.db" "$partial/jhwan.db"
cp -a -- "$DATA_DIR/uploads/." "$partial/uploads/"

log "백업 DB와 미디어를 독립적으로 검증합니다."
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --volume "$partial:/backup:ro" \
  --entrypoint node \
  "$image_id" \
  ./scripts/verify-content-backup.mjs \
  --database /backup/jhwan.db \
  --media /backup/uploads \
  >"$partial/manifest.json"

(
  cd -- "$partial"
  find . -type f ! -name checksums.sha256 -print0 \
    | sort -z \
    | xargs -0 sha256sum >checksums.sha256
)

mv -- "$partial" "$final"
rm -rf -- "$staging"
trap - EXIT

mapfile -t backups < <(
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
    | awk '/^[0-9]{8}-[0-9]{6}$/' \
    | sort
)
while (( ${#backups[@]} > RETENTION )); do
  oldest="${backups[0]}"
  candidate="$(realpath -e -- "$BACKUP_ROOT/$oldest")"
  case "$candidate" in
    "$backup_root_real"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]) ;;
    *) fail "보존 기간 정리 대상을 거부합니다: $candidate" ;;
  esac
  rm -rf -- "$candidate"
  backups=("${backups[@]:1}")
done

log "백업 완료: $final"
printf 'BACKUP_CREATED=%s\n' "$stamp"
