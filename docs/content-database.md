# 콘텐츠 DB 런타임

> 홈페이지는 Astro Node 서버가 SQLite에서 게시글을 읽어 동적으로 응답합니다. Raspberry Pi의
> 영구 볼륨과 백업은 다음 배포 구간에서 연결하므로 관리자 쓰기는 기본적으로 비활성화합니다.

## 구성

- 런타임: Node.js 24.15 이상에 포함된 `node:sqlite`
- 마이그레이션: `database/migrations/*.sql`
- 기본 개발 경로: `.data/jhwan.db` (Git 제외)
- 컨테이너 임시 경로: `/app/.data/jhwan.db`
- 운영 영구 경로: 이후 Raspberry Pi의 Docker 영구 볼륨으로 별도 지정
- 보호 장치: 외래 키, WAL, 무결성 검사, 마이그레이션 체크섬, 쓰기 트랜잭션

DB에는 게시글 본문과 메타데이터, 수정 이력, 미디어 메타데이터만 저장합니다. 이미지 파일 자체는
DB BLOB으로 넣지 않고 이후 영구 업로드 볼륨에 저장합니다.

## 검사

Markdown이 DB 레코드로 변환 가능한지 검사하거나 동적 런타임 회귀 테스트를 실행합니다.

```bash
npm run db:import
npm run test:runtime
```

SQLite 기반 회귀 테스트는 임시 디렉터리와 메모리 DB만 사용합니다.

```bash
npm run test:db
```

## 명시적 로컬 적용

마이그레이션과 가져오기는 실수로 운영 데이터를 변경하지 않도록 대상 경로를 반드시 요구합니다.

```bash
npm run db:migrate -- --database .data/jhwan.db
npm run db:import -- --apply --database .data/jhwan.db
```

같은 Markdown을 다시 가져오면 체크섬이 같은 글은 건너뜁니다. 내용이 바뀐 글만 새 버전으로
갱신하고 `post_revisions`에 스냅샷을 남깁니다. 같은 slug가 다른 원본 경로에 이미 연결되어 있으면
전체 가져오기를 롤백합니다.

## 관리자 API 기반

관리자 HTTP API는 `/api/admin/*`에 구현되어 있지만 `JHWAN_ADMIN_ENABLED=true`일 때만 열립니다.
영구 저장소가 없는 현재 운영 Compose에서는 이 값을 설정하지 않으므로 API가 `503`으로 닫힙니다.
구현된 보호 장치는 다음과 같습니다.

- OAuth Worker가 발급할 HS256 1회용 로그인 티켓 검증
- 숫자로 고정한 GitHub 사용자 ID allowlist
- 로그인 티켓 재사용 차단
- 원문 대신 SHA-256 해시만 저장하는 불투명 세션과 CSRF 토큰
- `HttpOnly`, `Secure`, `SameSite=Strict`, `__Host-` 관리자 쿠키
- 수정 버전에 기반한 동시 편집 충돌 방지
- 게시글 소프트 삭제와 복구, 전체 수정 이력
- slug 변경 전 주소 보존 및 재사용 차단

Cloudflare Worker는 GitHub access token으로 숫자 사용자 ID를 확인한 뒤 토큰을 폐기하고, 브라우저
URL fragment에는 2분짜리 HS256 일회성 로그인 티켓만 전달합니다. 홈페이지 서버는 티켓을 한 번만
교환해 8시간짜리 불투명 세션을 만들며 원문 세션·CSRF 토큰 대신 SHA-256 해시만 DB에 저장합니다.

## 새 관리자 화면 미리보기

새 글쓰기 화면은 `admin/`에 있으며 실제 `/api/admin` 클라이언트가 기본입니다. 현재 운영
`/admin/`과 Docker 이미지에는 아직 포함되지 않습니다. 로컬 UI만 확인할 때는 `?demo=1`을 붙여
예시 데이터를 사용할 수 있습니다.

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
- Markdown 표와 코드 블록 왕복 변환 회귀 테스트

시각 편집기는 Tiptap의 Markdown 확장을 사용합니다. 해당 확장은 현재 Beta이므로 Markdown 원문
모드를 항상 함께 제공하며, 표와 코드 블록을 포함한 왕복 변환을 CI에서 검사합니다. 운영 API,
이미지 업로드는 다음 구간에서 연결합니다. 인증·DB CRUD·소프트 삭제·복구·수정 이력은 HTTP와
실제 Astro 서버를 거치는 자동 테스트까지 포함합니다.

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
설정합니다. 실제 활성화는 영구 볼륨·백업을 붙이는 배포 구간에서 수행합니다.

```text
JHWAN_ADMIN_ENABLED=true
JHWAN_DATABASE_PATH=/data/jhwan.db
ADMIN_GITHUB_USER_ID=<숫자 GitHub 사용자 ID>
ADMIN_LOGIN_TICKET_SECRET=<양쪽에 동일한 32바이트 이상 임의 값>
```
