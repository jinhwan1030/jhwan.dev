# jhwan.dev Raspberry Pi runtime

`compose.yml`은 `legyeseul/jhwan-homepage:latest`의 Astro Node 서버를 호스트 포트 `4321`에서
실행하고 `/blog/` 응답으로 Node 런타임과 SQLite 초기화를 함께 healthcheck합니다. 컨테이너는
기존 Nginx 이미지와 같은 내부 포트 `80`을 유지해 Raspberry Pi의 기존 Compose와 호환됩니다.

`./data`를 컨테이너의 `/data`에 바인드해 DB와 업로드 파일을 이미지 교체와 분리합니다. 컨테이너
entrypoint는 `.legacy-migration-complete` 표시가 없을 때만 이미지에 포함된 기존 Markdown과 미디어를
`/data/jhwan.db`, `/data/uploads`로 이전합니다. 이후 재기동과 이미지 갱신에서는 해당 데이터를
다시 가져오지 않습니다.

운영 위치:

```text
/home/jinhwan/projects/jhwan-homepage/compose.yml
```

공통 자동 업데이터는 BabyWeather 저장소의
`scripts/install-auto-deploy.sh`로 최초 한 번 설치합니다. 이후에는 main push와 GitHub
Actions 이미지 빌드가 끝나면 라즈베리파이가 새 이미지를 자동으로 적용합니다.

최초 설치기는 관리자 API를 끈 상태로 영속 저장소 이전과 healthcheck를 마치고, 첫 검증 백업까지
성공한 뒤에만 `.env`의 `JHWAN_ADMIN_ENABLED=true`를 적용합니다. 운영 비밀값은 이미지와 Compose에
기록하지 않고 `/home/jinhwan/projects/jhwan-homepage/.env`에 권한 `0600`으로 둡니다.

운영 `/admin/`은 홈페이지 이미지에 함께 포함된 Content Studio입니다. 게시글은 `/data/jhwan.db`,
업로드 이미지는 `/data/uploads`에 즉시 저장되므로 글 저장만으로 컨테이너를 다시 빌드하거나
배포하지 않습니다. `ADMIN_GITHUB_USER_ID`와 `ADMIN_LOGIN_TICKET_SECRET`은 Cloudflare OAuth
Worker에 등록한 값과 같아야 합니다.

## 백업과 복구

`jhwan-homepage-backup.timer`는 매일 03:30 전후에 온라인 SQLite 백업과 전체 업로드 사본을 만듭니다.
백업은 DB 무결성·외래 키·미디어 크기와 SHA-256을 독립 검증하고, 모든 파일의 체크섬을 기록한 뒤에만
완성 디렉터리로 승격합니다. 최근 14개를 보존합니다.

```text
/home/jinhwan/projects/jhwan-homepage/data
/home/jinhwan/backups/jhwan-homepage/YYYYMMDD-HHMMSS
```

라즈베리파이의 운영 사용자로 다음 명령을 실행합니다. 기본 실행과 `--backup`은 읽기 전용이며,
실제 교체는 정확한 timestamp, `--apply`, 대화형 `RESTORE` 확인이 모두 필요합니다.

```bash
/usr/local/sbin/jhwan-homepage-restore
/usr/local/sbin/jhwan-homepage-restore --backup YYYYMMDD-HHMMSS
/usr/local/sbin/jhwan-homepage-restore --apply --backup YYYYMMDD-HHMMSS
```

실제 복구 전에는 현 데이터를 한 번 더 백업합니다. 복구본이 기동하지 않으면 직전 데이터를 다시
놓고, 성공하면 보안을 위해 기존 관리자 세션을 모두 폐기합니다.
