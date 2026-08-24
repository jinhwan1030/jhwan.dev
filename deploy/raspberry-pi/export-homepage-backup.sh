#!/usr/bin/env bash

set -Eeuo pipefail

BACKUP_ROOT="${JHWAN_HOMEPAGE_BACKUP_ROOT:-$HOME/backups/jhwan-homepage}"
LOCK_FILE="${JHWAN_HOMEPAGE_BACKUP_LOCK:-/run/lock/jhwan-homepage-backup.lock}"
LOCK_WAIT_SECONDS="${JHWAN_HOMEPAGE_EXPORT_LOCK_WAIT_SECONDS:-600}"

fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ -z "${SSH_ORIGINAL_COMMAND:-}" ]] || fail "이 키는 홈페이지 백업 내보내기만 허용합니다."
[[ "$LOCK_WAIT_SECONDS" =~ ^[0-9]+$ ]] || fail "잠금 대기 시간은 0 이상의 정수여야 합니다."
for command_name in flock realpath sha256sum tar; do
  command -v "$command_name" >/dev/null 2>&1 || fail "필수 명령을 찾을 수 없습니다: $command_name"
done
[[ -d "$BACKUP_ROOT" && ! -L "$BACKUP_ROOT" ]] || fail "백업 루트가 없습니다."
backup_root_real="$(realpath -e -- "$BACKUP_ROOT")"

exec 9>"$LOCK_FILE"
flock --wait "$LOCK_WAIT_SECONDS" 9 || fail "백업 잠금을 확보하지 못했습니다."

stamp="$(
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' \
    | awk '/^[0-9]{8}-[0-9]{6}$/' \
    | sort -r \
    | sed -n '1p'
)"
[[ -n "$stamp" ]] || fail "내보낼 홈페이지 백업이 없습니다."
backup_path="$BACKUP_ROOT/$stamp"
backup_real="$(realpath -e -- "$backup_path")"
[[ "$backup_real" == "$backup_root_real/$stamp" ]] || fail "백업 루트 밖의 경로를 거부합니다."

for required in jhwan.db checksums.sha256 manifest.json; do
  [[ -f "$backup_path/$required" && ! -L "$backup_path/$required" ]] || fail "백업 파일이 없습니다: $required"
done
[[ -d "$backup_path/uploads" && ! -L "$backup_path/uploads" ]] || fail "업로드 백업이 없습니다."
(
  cd -- "$backup_path"
  sha256sum --check --strict checksums.sha256 >/dev/null
)

tar --create --gzip --directory "$backup_root_real" --file - "$stamp"
