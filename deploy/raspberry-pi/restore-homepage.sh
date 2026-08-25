#!/usr/bin/env bash

set -Eeuo pipefail

HOMEPAGE_DIR="${JHWAN_HOMEPAGE_DIR:-$HOME/projects/jhwan-homepage}"
DATA_DIR="${JHWAN_HOMEPAGE_DATA_DIR:-$HOMEPAGE_DIR/data}"
BACKUP_ROOT="${JHWAN_HOMEPAGE_BACKUP_ROOT:-$HOME/backups/jhwan-homepage}"
LOCK_FILE="${JHWAN_HOMEPAGE_BACKUP_LOCK:-/run/lock/jhwan-homepage-backup.lock}"
UPDATE_LOCK_FILE="${JHWAN_AUTO_UPDATE_LOCK_FILE:-/run/lock/jhwan-auto-update.lock}"
CONTAINER_NAME="${JHWAN_HOMEPAGE_CONTAINER:-jhwan-homepage}"
BACKUP_COMMAND="${JHWAN_HOMEPAGE_BACKUP_COMMAND:-/usr/local/sbin/jhwan-homepage-backup}"
HEALTH_URL="${JHWAN_HOMEPAGE_HEALTH_URL:-http://127.0.0.1:4321/api/health}"
APPLY=false
BACKUP_STAMP=""

usage() {
  cat <<'USAGE'
사용법:
  jhwan-homepage-restore
  jhwan-homepage-restore --backup YYYYMMDD-HHMMSS
  jhwan-homepage-restore --apply --backup YYYYMMDD-HHMMSS

기본 실행은 백업 목록만 표시합니다. --backup은 체크섬과 DB·미디어를 읽기 전용으로
검증하며, 실제 복구는 --apply와 RESTORE 확인 입력이 모두 있어야 합니다.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=true; shift ;;
    --backup) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; BACKUP_STAMP="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "알 수 없는 인자: $1" >&2; usage >&2; exit 2 ;;
  esac
done

for command_name in docker flock realpath sha256sum curl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "필수 명령을 찾을 수 없습니다: $command_name" >&2
    exit 1
  }
done

[[ -d "$BACKUP_ROOT" && ! -L "$BACKUP_ROOT" ]] || { echo "백업 디렉터리가 없습니다: $BACKUP_ROOT" >&2; exit 1; }
backup_root_real="$(realpath -e -- "$BACKUP_ROOT")"

if [[ -z "$BACKUP_STAMP" ]]; then
  echo "[복구 가능한 홈페이지 백업]"
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
    | awk '/^[0-9]{8}-[0-9]{6}$/' \
    | sort -r
  exit 0
fi

[[ "$BACKUP_STAMP" =~ ^[0-9]{8}-[0-9]{6}$ ]] || { echo "잘못된 백업 timestamp입니다." >&2; exit 2; }
exec 9>"$LOCK_FILE"
if ! flock --nonblock 9; then
  echo "다른 홈페이지 백업 또는 복구가 실행 중입니다." >&2
  exit 1
fi
backup_path="$BACKUP_ROOT/$BACKUP_STAMP"
[[ -d "$backup_path" && ! -L "$backup_path" ]] || { echo "백업을 찾을 수 없습니다: $backup_path" >&2; exit 1; }
backup_real="$(realpath -e -- "$backup_path")"
case "$backup_real" in "$backup_root_real"/*) ;; *) echo "백업 루트 밖의 경로를 거부합니다." >&2; exit 1 ;; esac

for required in jhwan.db uploads checksums.sha256 manifest.json; do
  [[ -e "$backup_path/$required" ]] || { echo "백업 구성요소가 없습니다: $required" >&2; exit 1; }
done

(
  cd -- "$backup_path"
  sha256sum --check --strict checksums.sha256
)

image_id="$(docker container inspect --format '{{.Image}}' "$CONTAINER_NAME")"
docker run --rm \
  --user "$(id -u):$(id -g)" \
  --volume "$backup_path:/backup:ro" \
  --entrypoint node \
  "$image_id" \
  ./scripts/verify-content-backup.mjs \
  --database /backup/jhwan.db \
  --media /backup/uploads

if [[ "$APPLY" != true ]]; then
  echo "✓ 읽기 전용 복구 사전 검증 완료: $BACKUP_STAMP"
  echo "  실제 복구: jhwan-homepage-restore --apply --backup $BACKUP_STAMP"
  exit 0
fi

echo "복구 대상: $backup_path"
echo "현재 운영 데이터는 복구 직전 자동 백업한 뒤 교체됩니다."
read -r -p "계속하려면 RESTORE를 입력하세요: " confirmation
[[ "$confirmation" == "RESTORE" ]] || { echo "복구를 취소했습니다."; exit 1; }

exec 8>"$UPDATE_LOCK_FILE"
if ! flock --nonblock 8; then
  echo "홈페이지 자동 업데이트가 실행 중입니다. 완료 후 다시 시도해주세요." >&2
  exit 1
fi

JHWAN_HOMEPAGE_BACKUP_SKIP_LOCK=true "$BACKUP_COMMAND"

compose=(docker compose --project-directory "$HOMEPAGE_DIR" --file "$HOMEPAGE_DIR/compose.yml")
staging="$(mktemp -d "$DATA_DIR/.restore-stage-$BACKUP_STAMP.XXXXXX")"
rollback="$(mktemp -d "$DATA_DIR/.restore-rollback-$BACKUP_STAMP.XXXXXX")"

cleanup_staging() {
  rm -rf -- "$staging"
}
trap cleanup_staging EXIT

cp -- "$backup_path/jhwan.db" "$staging/jhwan.db"
cp -a -- "$backup_path/uploads" "$staging/uploads"

"${compose[@]}" stop homepage
for name in jhwan.db jhwan.db-wal jhwan.db-shm uploads .legacy-migration-complete; do
  [[ -e "$DATA_DIR/$name" ]] && mv -- "$DATA_DIR/$name" "$rollback/$name"
done

restore_previous() {
  echo "복구한 데이터의 기동 실패, 직전 운영 데이터로 되돌립니다." >&2
  "${compose[@]}" stop homepage >/dev/null 2>&1 || true
  rm -rf -- "$DATA_DIR/jhwan.db" "$DATA_DIR/jhwan.db-wal" "$DATA_DIR/jhwan.db-shm" \
    "$DATA_DIR/uploads" "$DATA_DIR/.legacy-migration-complete"
  for item in "$rollback"/* "$rollback"/.[!.]*; do
    [[ -e "$item" ]] || continue
    mv -- "$item" "$DATA_DIR/"
  done
  "${compose[@]}" up --detach homepage
}
trap restore_previous ERR

mv -- "$staging/jhwan.db" "$DATA_DIR/jhwan.db"
mv -- "$staging/uploads" "$DATA_DIR/uploads"
printf 'restored_from=%s\n' "$BACKUP_STAMP" >"$DATA_DIR/.legacy-migration-complete"

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --volume "$DATA_DIR:/data" \
  --entrypoint node \
  "$image_id" \
  ./scripts/invalidate-admin-sessions.mjs \
  --database /data/jhwan.db

"${compose[@]}" up --detach homepage
ready=false
for _ in {1..45}; do
  state="$(docker inspect --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER_NAME" 2>/dev/null || true)"
  if [[ ( "$state" == 'running|healthy' || "$state" == 'running|none' ) ]] \
    && curl --fail --silent --show-error "$HEALTH_URL" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
[[ "$ready" == true ]]

trap - ERR
rm -rf -- "$rollback"
trap - EXIT
rm -rf -- "$staging"
echo "✓ 홈페이지 복구 완료: $BACKUP_STAMP"
echo "  보안을 위해 기존 관리자 세션은 모두 폐기했습니다."
