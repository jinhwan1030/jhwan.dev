# 글 관리

jhwan.dev의 글은 `https://jhwan.dev/admin/`의 자체 Content Studio에서 관리합니다. GitHub는
관리자 본인 확인에만 사용합니다. 글과 이미지는 홈페이지 서버의 영속 SQLite와 업로드 디렉터리에
저장되므로 게시할 때 Git 커밋이나 GitHub Actions 빌드를 기다리지 않습니다.

## 게시 흐름

1. `/admin/`에서 **GitHub로 로그인**을 누릅니다.
2. **새 글**에서 제목, 주소, 설명, 카테고리, 본문과 공개 상태를 입력합니다.
3. 필요한 이미지는 본문 도구막대 또는 대표 이미지 영역에서 업로드합니다.
4. 작성 중에는 **초안**, 게시할 때는 **공개**를 선택해 저장합니다.
5. 공개 시각이 현재보다 늦으면 해당 시각이 지난 뒤 사이트에 나타납니다.

저장된 공개 글은 다음 요청부터 홈페이지, 글 목록, RSS와 사이트맵에 반영됩니다. 글 삭제는 즉시
영구 삭제하지 않고 휴지통으로 이동하며 관리자 화면에서 복구할 수 있습니다. 동시에 열린 두 화면이
같은 글을 덮어쓰지 않도록 버전 충돌을 검사하고, 저장 전 수정 이력을 남깁니다.

편집기는 시각 편집, Markdown 원문, 미리보기를 제공합니다. 브라우저에 서버보다 새로운 임시
저장본이 있으면 다시 접속할 때 복구 여부를 묻습니다. 본문과 대표 이미지는 JPEG, PNG, WebP,
GIF, AVIF를 지원하며 파일당 최대 25 MiB입니다. 서버는 실제 이미지 형식과 크기를 검사하고 같은
내용의 파일은 한 번만 보관합니다.

## 운영 인증 구조

`auth.jhwan.dev`의 Cloudflare Worker가 GitHub OAuth를 처리합니다.

1. Worker가 `read:user` 권한으로 GitHub 숫자 사용자 ID를 확인합니다.
2. ID가 `ADMIN_GITHUB_USER_ID`와 일치할 때만 2분짜리 일회성 로그인 티켓을 발급합니다.
3. GitHub access token은 Worker 밖이나 브라우저로 전달하지 않습니다.
4. 홈페이지 서버가 티켓을 한 번 교환해 8시간짜리 관리자 세션을 만듭니다.

세션은 `HttpOnly`, `Secure`, `SameSite=Strict` 쿠키를 사용하고 변경 요청은 별도 CSRF 토큰을
검증합니다. 세션과 CSRF 원문은 DB에 저장하지 않고 SHA-256 해시만 보관합니다.

### GitHub OAuth App

GitHub **Settings → Developer settings → OAuth Apps**의 전용 App은 다음 값을 사용합니다.

- Application name: `jhwan.dev Content Studio`
- Homepage URL: `https://jhwan.dev/admin/`
- Authorization callback URL: `https://auth.jhwan.dev/callback`

이 OAuth App은 저장소 쓰기 권한을 요청하지 않습니다. Client Secret은 저장소, 홈페이지 Docker
이미지 또는 Raspberry Pi에 넣지 않고 Cloudflare Worker Secret으로만 보관합니다.

### Cloudflare Worker secret

로컬 최초 설정 파일은 `deploy/cloudflare/cms-oauth/.dev.vars`이며 Git에서 제외됩니다.
`cms-oauth`는 기존 Cloudflare Worker·GitHub Environment와의 호환을 위해 유지하는 내부
식별자입니다. 현재 사용자 화면은 자체 Content Studio이며, 저장소 기반 CMS는 사용하지 않습니다.

```dotenv
GITHUB_OAUTH_ID="GitHub OAuth App Client ID"
GITHUB_OAUTH_SECRET="GitHub OAuth App Client Secret"
ADMIN_GITHUB_USER_ID="숫자로 된 GitHub 사용자 ID"
ADMIN_LOGIN_TICKET_SECRET="32바이트 이상의 임의 문자열"
```

`ADMIN_LOGIN_TICKET_SECRET`은 Raspberry Pi의 홈페이지 `.env` 값과 정확히 같아야 합니다. 최초
Worker 배포와 secret 등록은 다음 명령으로 수행합니다.

```bash
cd deploy/cloudflare/cms-oauth
npm test
npx --yes wrangler@4.123.0 login
npm run deploy -- --secrets-file .dev.vars
```

이후 Worker 코드 변경은 `.github/workflows/deploy-cms-oauth.yml`이 테스트한 뒤 배포합니다.
GitHub의 `cms-oauth` Environment에는 `CLOUDFLARE_ACCOUNT_ID`와 Workers Scripts 편집 범위의
`CLOUDFLARE_API_TOKEN`을 등록합니다. GitHub OAuth secret 네 개는 Cloudflare에 계속 보존되며
일반 코드 배포 때 다시 올리지 않습니다.

### Raspberry Pi 홈페이지 환경 변수

`/home/jinhwan/projects/jhwan-homepage/.env`에는 다음 값을 권한 `0600`으로 보관합니다.

```dotenv
JHWAN_ADMIN_ENABLED=true
JHWAN_DATABASE_PATH=/data/jhwan.db
JHWAN_MEDIA_PATH=/data/uploads
ADMIN_GITHUB_USER_ID="Worker와 같은 숫자 ID"
ADMIN_LOGIN_TICKET_SECRET="Worker와 같은 임의 문자열"
```

## 배포와 확인

Content Studio 소스는 `admin/`에 있습니다. 홈페이지 빌드가 이를 번들링해 운영 산출물의
`/admin/`에 설치하므로 별도 관리자 컨테이너는 없습니다.

```bash
npm run test:admin-ui
npm run admin:build
npm run build
npm run admin:validate-build
node scripts/validate-admin-runtime.mjs
```

`main` push는 홈페이지 코드와 관리자 화면을 Docker 이미지로 배포합니다. 반면 관리 화면에서
글을 저장하는 행위는 DB만 갱신하므로 Actions나 컨테이너 재배포를 실행하지 않습니다.

운영 확인:

```bash
curl --fail https://auth.jhwan.dev/health
curl --fail https://jhwan.dev/admin/
```

첫 응답은 `jhwan administrator OAuth: ok`, 두 번째 응답은 `jhwan.dev Content Studio` 제목을
포함해야 합니다. 로그인 문제를 확인할 때 GitHub Client Secret이나 로그인 티켓을 로그에 출력하지
않습니다.

## 로컬 UI 확인

운영 API 없이 화면만 확인하려면 다음 명령을 실행하고 Vite가 안내한 주소에 `?demo=1`을 붙입니다.

```bash
npm run admin:dev
```

데모 모드는 메모리 데이터만 사용합니다. 실제 DB·인증·업로드 동작은 자동 런타임 검증 또는
HTTPS 운영 환경에서 확인합니다. 로컬 파일을 직접 선택해 Git에 글을 쓰는 기능은 사용하지 않습니다.
