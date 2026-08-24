#!/usr/bin/env bash

set -Eeuo pipefail

AUTHORIZED_KEYS="${JHWAN_HOMEPAGE_AUTHORIZED_KEYS:-$HOME/.ssh/authorized_keys}"
EXPORT_COMMAND="/usr/local/sbin/jhwan-homepage-offsite-export"
COMMENT="jhwan-homepage-offsite"

IFS= read -r public_key
[[ "$public_key" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+={0,3}\ ${COMMENT}$ ]] || {
  echo "전용 ED25519 공개키 형식이 올바르지 않습니다." >&2
  exit 1
}
[[ ! -L "$HOME/.ssh" && ! -L "$AUTHORIZED_KEYS" ]] || {
  echo "심볼릭 링크 SSH 경로를 거부합니다." >&2
  exit 1
}

install -d -m 0700 -- "$HOME/.ssh"
touch "$AUTHORIZED_KEYS"
chmod 0600 "$AUTHORIZED_KEYS"
temporary="$(mktemp "$HOME/.ssh/.authorized_keys.XXXXXX")"
cleanup() { rm -f -- "$temporary"; }
trap cleanup EXIT
awk -v comment="$COMMENT" 'index($0, comment) == 0' "$AUTHORIZED_KEYS" >"$temporary"
printf 'restrict,command="%s" %s\n' "$EXPORT_COMMAND" "$public_key" >>"$temporary"
chmod 0600 "$temporary"
mv -- "$temporary" "$AUTHORIZED_KEYS"
trap - EXIT
echo "✓ 제한된 홈페이지 백업 키를 등록했습니다."
