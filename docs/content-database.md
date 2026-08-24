# 콘텐츠 DB 런타임

> 홈페이지는 Astro Node 서버가 Raspberry Pi의 영속 SQLite에서 게시글을 읽어 동적으로 응답합니다.
> 최초 검증 백업이 성공한 뒤에만 관리자 쓰기를 활성화합니다.

## 구성

- 런타임: Node.js 24.15 이상에 포함된 `node:sqlite`
- 마이그레이션: `database/migrations/*.sql`
- 기본 개발 경로: `.data/jhwan.db` (Git 제외)
- 기본 개발 미디어 경로: `.data/uploads` (Git 제외)
- 컨테이너 운영 경로: `/data/jhwan.db`, `/data/uploads`
- Raspberry Pi 영구 경로: `/home/jinhwan/projects/jhwan-homepage/data`
- 검증 백업 경로: `/home/jinhwan/backups/jhwan-homepage/YYYYMMDD-HHMMSS`
- 보호 장치: 외래 키, WAL, 무결성 검사, 마이그레이션 체크섬, 쓰기 트랜잭션

DB에는 게시글 본문과 메타데이터, 수정 이력, 미디어 메타데이터만 저장합니다. 이미지 파일 자체는
DB BLOB으로 넣지 않고 영구 업로드 디렉터리에 저장합니다.

## 검사

기존 Markdown과 미디어가 DB·업로드 구조로 변환 가능한지 검사하거나 동적 런타임 회귀 테스트를
실행합니다. 첫 명령은 메모리 DB만 사용하며 저장소 파일을 변경하지 않습니다.

```bash
npm run db:migrate-legacy
npm run test:runtime
```

SQLite 기반 회귀 테스트는 임시 디렉터리와 메모리 DB만 사용합니다.

```bash
npm run test:db
```

## 기존 콘텐츠와 미디어 이전

현재 저장소의 `src/content/blog`은 최초 DB 이전에만 사용하는 Markdown seed입니다.
`src/assets/blog`에 실제 업로드 이미지가 없어도 정상적인 이전 결과입니다. 과거 저장소 기반
관리 단계에서 만든 seed에 이미지가 포함된 경우에도 같은 명령이 파일을 검사하고 함께
이전합니다. 운영 게시의 원본은 Markdown이 아니라 영속 SQLite입니다.

```bash
npm run db:migrate-legacy
```

이전 도구의 보호 장치는 다음과 같습니다.

- `--apply`가 없으면 메모리 DB에서만 전체 변환과 무결성 검사를 수행
- 실제 적용 시 DB 경로와 업로드 경로를 모두 명시하도록 강제
- 게시글과 미디어 메타데이터를 한 SQLite 트랜잭션으로 반영
- 같은 이미지 내용을 SHA-256 기반 파일명으로 한 번만 저장
- 본문과 대표 이미지의 기존 상대 경로를 `/uploads/<hash>.<ext>`로 변환
- 25 MiB 초과 파일, 지원하지 않는 이미지, 심볼릭 링크와 관리 폴더 밖 경로를 거부
- slug가 관리자 작성 글이나 다른 원본과 충돌하면 전체 DB 변경을 롤백
- 실패 시 이번 실행에서 새로 복사한 미디어 파일만 제거
- 재실행 시 동일 게시글과 미디어를 변경하지 않는 멱등성 보장

실제 적용 명령은 다음과 같습니다. 운영 컨테이너 entrypoint가 최초 실행 때 같은 작업을 수행하고
완료 표시를 원자적으로 만든 뒤, 다음 실행부터 건너뜁니다.

```bash
npm run db:migrate-legacy -- \
  --apply \
  --database /data/jhwan.db \
  --uploads /data/uploads
```

적용 결과의 `verification.integrity`가 `ok`, `foreignKeyViolations`가 `0`인지 확인해야 합니다.
미디어 결과의 `total`은 원본 파일 수, `unique`는 내용이 중복되지 않은 이미지 수입니다.
`copiedMedia`는 이번 실행에서 새로 복사한 고유 파일 수이며, 같은 입력을 다시 실행하면 게시글과
미디어가 `unchanged`로 집계됩니다.

## 저수준 DB 명령

마이그레이션과 가져오기는 실수로 운영 데이터를 변경하지 않도록 대상 경로를 반드시 요구합니다.

```bash
npm run db:migrate -- --database .data/jhwan.db
npm run db:import -- --apply --database .data/jhwan.db
```

같은 Markdown을 다시 가져오면 체크섬이 같은 글은 건너뜁니다. 내용이 바뀐 글만 새 버전으로
갱신하고 `post_revisions`에 스냅샷을 남깁니다. 같은 slug가 다른 원본 경로에 이미 연결되어 있으면
전체 가져오기를 롤백합니다. 이 저수준 명령은 미디어를 복사하거나 본문 이미지 경로를 변환하지
않으므로 운영 전환에는 위의 `db:migrate-legacy` 명령을 사용합니다.

## 관리자 API 기반

관리자 HTTP API는 `/api/admin/*`에 구현되어 있지만 `JHWAN_ADMIN_ENABLED=true`일 때만 열립니다.
최초 설치기는 관리자 API가 `503`인 상태에서 영속 저장소 이전과 첫 백업을 검증한 뒤 활성화하며,
인증되지 않은 `/api/admin/session` 응답이 `401`인지 확인합니다.
구현된 보호 장치는 다음과 같습니다.

- OAuth Worker가 발급할 HS256 1회용 로그인 티켓 검증
- 숫자로 고정한 GitHub 사용자 ID allowlist
- 로그인 티켓 재사용 차단
- 원문 대신 SHA-256 해시만 저장하는 불투명 세션과 CSRF 토큰
- `HttpOnly`, `Secure`, `SameSite=Strict`, `__Host-` 관리자 쿠키
- 수정 버전에 기반한 동시 편집 충돌 방지
- 게시글 소프트 삭제와 복구, 전체 수정 이력
- slug 변경 전 주소 보존 및 재사용 차단

Cloudflare Worker는 GitHub access token으로 숫자 사용자 ID를 확인하고 요청 처리 후 보관하지
않습니다. 토큰은 Worker 밖이나 브라우저로 전달하지 않고, 브라우저 URL fragment에는
2분짜리 HS256 일회성 로그인 티켓만 전달합니다. 홈페이지 서버는 티켓을 한 번만
교환해 8시간짜리 불투명 세션을 만들며 원문 세션·CSRF 토큰 대신 SHA-256 해시만 DB에 저장합니다.

## 운영 관리자 화면

글쓰기 화면 소스는 `admin/`에 있으며 실제 `/api/admin` 클라이언트가 기본입니다. 홈페이지
빌드가 화면을 번들링해 Docker 이미지의 `/admin/`에 설치합니다. 로컬에서 UI만 확인할 때는
`?demo=1`을 붙여 예시 데이터를 사용할 수 있습니다.

```bash
npm run admin:dev
npm run test:admin-ui
npm run admin:build
```

화면은 데스크톱에서 글 목록, 편집기, 게시 설정을 한 화면에 배치하고 각 영역만 독립적으로
스크롤합니다. 작은 화면에서는 글 목록과 게시 설정을 필요할 때 여는 구조입니다. 제공 기능은
다음과 같습니다.

- WYSIWYG 편집, Markdown 원문 편집, 게시물 미리보기
- 제목, slug, 설명, 카테고리, 공개 상태와 공개 시각 관리
- 검색과 상태 필터, 새 글, 저장, 소프트 삭제, 복구, 수정 이력
- 저장하지 않은 변경 감지, `Ctrl/Cmd+S`, 브라우저 임시 저장본 복구
- Markdown 표·코드 블록·이미지 왕복 변환 회귀 테스트
- 본문 이미지와 대표 이미지 업로드

시각 편집기는 Tiptap의 Markdown 확장을 사용합니다. 해당 확장은 현재 Beta이므로 Markdown 원문
모드를 항상 함께 제공하며, 표·코드 블록·이미지를 포함한 왕복 변환을 CI에서 검사합니다.
인증·DB CRUD·미디어 업로드·소프트 삭제·복구·수정 이력은 HTTP와 실제 Astro 서버를 거치는
자동 테스트까지 포함합니다. 이미지는 파일당 25 MiB와 4천만 픽셀로 제한하고 실제 형식과 선언
MIME가 일치하는지 검사합니다.

## 런타임 초기화와 공개 조건

컨테이너의 DB가 완전히 비어 있을 때만 `src/content/blog`의 Markdown을 한 번 초기 적재합니다.
DB에 글이 하나라도 있으면 이후 시작 시 Markdown을 다시 가져오지 않으므로 관리자 수정 내용을
덮어쓰지 않습니다. 공개 목록·상세·RSS·사이트맵에는 다음 조건을 모두 만족한 글만 나타납니다.

- `status = published`
- 휴지통으로 이동하지 않음
- `published_at`이 현재 시각 이전

본문 Markdown은 GFM 규칙으로 HTML로 바꾼 뒤 script, 이벤트 속성, `javascript:` URL 등을 제거합니다.
공개 응답은 재검증 캐시 헤더를 사용하므로 DB 저장 후 이미지 재빌드 없이 다음 요청부터 반영됩니다.

## 운영 활성화에 필요한 환경 변수

다음 값은 코드나 이미지에 넣지 않고 Raspberry Pi와 Cloudflare Worker의 secret으로 각각
설정합니다. 홈페이지 secret은 Raspberry Pi의 `.env`에만 권한 `0600`으로 저장합니다.

```text
JHWAN_ADMIN_ENABLED=true
JHWAN_DATABASE_PATH=/data/jhwan.db
JHWAN_MEDIA_PATH=/data/uploads
ADMIN_GITHUB_USER_ID=<숫자 GitHub 사용자 ID>
ADMIN_LOGIN_TICKET_SECRET=<양쪽에 동일한 32바이트 이상 임의 값>
```

## 운영 백업과 복구

백업은 실행 중인 컨테이너와 정확히 같은 이미지의 Node `sqlite.backup()`을 사용해 DB 온라인 사본을
만듭니다. 이어서 미디어를 복사하고 별도 컨테이너에서 SQLite 무결성·외래 키·미디어 크기·내용
해시를 검사합니다. 검사가 끝난 백업에만 전체 SHA-256 목록을 기록하고 완성 이름을 부여합니다.

```bash
systemctl status jhwan-homepage-backup.timer
sudo systemctl start jhwan-homepage-backup.service
journalctl -u jhwan-homepage-backup.service --since today
```

복구는 먼저 목록 조회와 사전 검증을 수행합니다. 실제 적용 전 현 운영 데이터를 다시 백업하고,
DB·미디어 교체 후 healthcheck가 실패하면 직전 상태로 되돌립니다. 성공 시 복구된 DB의 모든 활성
관리자 세션을 폐기합니다.

```bash
/usr/local/sbin/jhwan-homepage-restore
/usr/local/sbin/jhwan-homepage-restore --backup YYYYMMDD-HHMMSS
/usr/local/sbin/jhwan-homepage-restore --apply --backup YYYYMMDD-HHMMSS
```
