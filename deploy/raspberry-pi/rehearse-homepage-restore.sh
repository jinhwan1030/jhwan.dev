#!/usr/bin/env bash

set -Eeuo pipefail

BACKUP_ROOT="${JHWAN_HOMEPAGE_BACKUP_ROOT:-$HOME/backups/jhwan-homepage}"
LOCK_FILE="${JHWAN_HOMEPAGE_BACKUP_LOCK:-/run/lock/jhwan-homepage-backup.lock}"
CONTAINER_NAME="${JHWAN_HOMEPAGE_CONTAINER:-jhwan-homepage}"
REHEARSAL_ROOT="${JHWAN_HOMEPAGE_REHEARSAL_ROOT:-/tmp}"
LOCK_WAIT_SECONDS="${JHWAN_HOMEPAGE_REHEARSAL_LOCK_WAIT_SECONDS:-0}"
BACKUP_STAMP=""

usage() {
  cat <<'USAGE'
사용법:
  jhwan-homepage-restore-rehearsal
  jhwan-homepage-restore-rehearsal --backup YYYYMMDD-HHMMSS

기본 실행은 가장 최근 백업을 선택합니다. 백업을 임시 디렉터리에 복사하고 격리된
Docker 네트워크에서만 홈페이지를 기동해 DB, 미디어, 공개 페이지를 검증합니다.
운영 데이터와 운영 컨테이너는 변경하지 않습니다.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backup) [[ $# -ge 2 ]] || { usage >&2; exit 2; }; BACKUP_STAMP="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "알 수 없는 인자: $1" >&2; usage >&2; exit 2 ;;
  esac
done

for command_name in docker flock realpath sha256sum mktemp; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "필수 명령을 찾을 수 없습니다: $command_name" >&2
    exit 1
  }
done
[[ "$LOCK_WAIT_SECONDS" =~ ^[0-9]+$ ]] || {
  echo "백업 잠금 대기 시간은 0 이상의 정수여야 합니다." >&2
  exit 1
}

[[ -d "$BACKUP_ROOT" && ! -L "$BACKUP_ROOT" ]] || {
  echo "백업 디렉터리가 없습니다: $BACKUP_ROOT" >&2
  exit 1
}
backup_root_real="$(realpath -e -- "$BACKUP_ROOT")"
[[ -d "$REHEARSAL_ROOT" && ! -L "$REHEARSAL_ROOT" ]] || {
  echo "리허설 임시 루트가 일반 디렉터리가 아닙니다: $REHEARSAL_ROOT" >&2
  exit 1
}
rehearsal_root_real="$(realpath -e -- "$REHEARSAL_ROOT")"

exec 9>"$LOCK_FILE"
if ! flock --wait "$LOCK_WAIT_SECONDS" 9; then
  echo "다른 홈페이지 백업 또는 복구가 실행 중이라 ${LOCK_WAIT_SECONDS}초 안에 시작하지 못했습니다." >&2
  exit 1
fi

if [[ -z "$BACKUP_STAMP" ]]; then
  BACKUP_STAMP="$(
    find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
      | awk '/^[0-9]{8}-[0-9]{6}$/' \
      | sort -r \
      | sed -n '1p'
  )"
  [[ -n "$BACKUP_STAMP" ]] || { echo "검증할 홈페이지 백업이 없습니다." >&2; exit 1; }
fi

[[ "$BACKUP_STAMP" =~ ^[0-9]{8}-[0-9]{6}$ ]] || {
  echo "잘못된 백업 timestamp입니다." >&2
  exit 2
}
backup_path="$BACKUP_ROOT/$BACKUP_STAMP"
[[ -d "$backup_path" && ! -L "$backup_path" ]] || {
  echo "백업을 찾을 수 없습니다: $backup_path" >&2
  exit 1
}
backup_real="$(realpath -e -- "$backup_path")"
case "$backup_real" in
  "$backup_root_real"/*) ;;
  *) echo "백업 루트 밖의 경로를 거부합니다." >&2; exit 1 ;;
esac

for required in jhwan.db checksums.sha256 manifest.json; do
  [[ -f "$backup_path/$required" && ! -L "$backup_path/$required" ]] || {
    echo "일반 백업 파일이 없습니다: $required" >&2
    exit 1
  }
done
[[ -d "$backup_path/uploads" && ! -L "$backup_path/uploads" ]] || {
  echo "일반 업로드 백업 디렉터리가 없습니다: uploads" >&2
  exit 1
}

(
  cd -- "$backup_path"
  sha256sum --check --strict checksums.sha256
)

image_id="$(docker container inspect --format '{{.Image}}' "$CONTAINER_NAME" 2>/dev/null || true)"
[[ -n "$image_id" ]] || { echo "홈페이지 이미지 ID를 확인할 수 없습니다." >&2; exit 1; }

work_directory="$(mktemp -d "$rehearsal_root_real/jhwan-homepage-restore-rehearsal.XXXXXX")"
work_real="$(realpath -e -- "$work_directory")"
case "$work_real" in
  "$rehearsal_root_real"/jhwan-homepage-restore-rehearsal.*) ;;
  *) echo "안전하지 않은 임시 경로를 거부합니다: $work_real" >&2; exit 1 ;;
esac
network_name="jhwan-restore-check-$$"
runtime_name="jhwan-restore-runtime-$$"
validator_name="jhwan-restore-validator-$$"
network_created=false

cleanup() {
  docker container rm --force "$validator_name" >/dev/null 2>&1 || true
  docker container rm --force "$runtime_name" >/dev/null 2>&1 || true
  if [[ "$network_created" == true ]]; then
    docker network rm "$network_name" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$work_real"
}
trap cleanup EXIT INT TERM

install -d -m 0700 -- "$work_real/data" "$work_real/data/uploads"
cp -- "$backup_path/jhwan.db" "$work_real/data/jhwan.db"
cp -a -- "$backup_path/uploads/." "$work_real/data/uploads/"

docker network create "$network_name" >/dev/null
network_created=true

echo "→ 격리된 홈페이지 복원본을 기동합니다: $BACKUP_STAMP"
docker run --detach \
  --name "$runtime_name" \
  --network "$network_name" \
  --network-alias homepage \
  --user "$(id -u):$(id -g)" \
  --env HOST=0.0.0.0 \
  --env PORT=8080 \
  --env JHWAN_ADMIN_ENABLED=false \
  --env JHWAN_DATABASE_PATH=/data/jhwan.db \
  --env JHWAN_MEDIA_PATH=/data/uploads \
  --volume "$work_real/data:/data" \
  --entrypoint node \
  "$image_id" \
  ./scripts/start-production-server.mjs >/dev/null

echo "→ 복원본의 DB·미디어와 실제 HTTP 응답을 검증합니다."
if ! docker run --rm \
  --name "$validator_name" \
  --network "$network_name" \
  --user "$(id -u):$(id -g)" \
  --volume "$work_real/data:/rehearsal" \
  --entrypoint node \
  "$image_id" \
  ./scripts/verify-restored-runtime.mjs \
  --origin http://homepage:8080 \
  --database /rehearsal/jhwan.db \
  --media /rehearsal/uploads; then
  echo "격리된 홈페이지 로그:" >&2
  docker container logs "$runtime_name" >&2 || true
  exit 1
fi

echo "✓ 격리 복원 리허설 완료: $BACKUP_STAMP"
echo "  운영 데이터와 운영 컨테이너는 변경하지 않았습니다."
