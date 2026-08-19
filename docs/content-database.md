# 콘텐츠 DB 전환 기반

> 현재 실서비스는 여전히 `src/content/blog`의 Markdown을 정적 빌드합니다. 이 문서는 DB 전환을
> 안전하게 준비하기 위한 개발용 기반을 설명하며, 아직 운영 DB를 만들거나 사용하지 않습니다.

## 구성

- 런타임: Node.js 24.15 이상에 포함된 `node:sqlite`
- 마이그레이션: `database/migrations/*.sql`
- 기본 개발 경로: `.data/jhwan.db` (Git 제외)
- 운영 경로: 이후 Raspberry Pi의 Docker 영구 볼륨으로 별도 지정
- 보호 장치: 외래 키, WAL, 무결성 검사, 마이그레이션 체크섬, 쓰기 트랜잭션

DB에는 게시글 본문과 메타데이터, 수정 이력, 미디어 메타데이터만 저장합니다. 이미지 파일 자체는
DB BLOB으로 넣지 않고 이후 영구 업로드 볼륨에 저장합니다.

## 검사

현재 Markdown이 DB 레코드로 변환 가능한지만 검사합니다. DB 파일을 만들지 않습니다.

```bash
npm run db:import
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

현재 관리자 API 핵심 로직은 HTTP 경로와 분리된 상태이며 아직 실서비스에서 호출할 수 없습니다.
다음 보호 장치를 먼저 회귀 테스트합니다.

- OAuth Worker가 발급할 HS256 1회용 로그인 티켓 검증
- 숫자로 고정한 GitHub 사용자 ID allowlist
- 로그인 티켓 재사용 차단
- 원문 대신 SHA-256 해시만 저장하는 불투명 세션과 CSRF 토큰
- `HttpOnly`, `Secure`, `SameSite=Strict`, `__Host-` 관리자 쿠키
- 수정 버전에 기반한 동시 편집 충돌 방지
- 게시글 소프트 삭제와 복구, 전체 수정 이력
- slug 변경 전 주소 보존 및 재사용 차단

GitHub access token은 새 관리자 화면이나 Raspberry Pi DB에 저장하지 않습니다. OAuth Worker와
홈페이지 서버가 공유할 로그인 티켓 서명 키는 운영 연결 구간에서 별도 secret으로 등록합니다.

## 새 관리자 화면 미리보기

DB 관리자 API와 연결하기 전에 글쓰기 흐름을 독립적으로 검증하는 화면은 `admin/`에 있습니다.
현재 운영 `/admin/`과 Docker 이미지에는 포함되지 않으며, 메모리 안의 예시 글만 사용하는 개발용
미리보기입니다.

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
이미지 업로드, 인증, 실제 DB 저장은 다음 연결 구간에서 이 독립 빌드에 붙입니다.
