# 글 관리

jhwan.dev의 글은 `/admin/`에 설치한 Decap CMS에서 작성합니다. CMS가 생성한 Markdown과
업로드 이미지는 기존 Astro 콘텐츠 구조에 저장되므로, 별도의 데이터베이스나 런타임
관리자 서버는 필요하지 않습니다.

## 게시 흐름

1. `https://jhwan.dev/admin/`에서 GitHub 계정으로 로그인합니다.
2. **블로그 → 새 글**에서 제목, 설명, 날짜, 카테고리와 본문을 작성합니다.
3. 처음 저장할 때는 **초안으로 숨기기**를 켜 둡니다.
4. 검토가 끝나면 초안 설정을 끄고 저장합니다.
5. CMS가 `main` 브랜치에 커밋하면 GitHub Actions가 홈페이지 이미지를 빌드합니다.
6. Raspberry Pi의 systemd 타이머가 새 이미지를 가져와 healthcheck 후 반영합니다.

초안은 Git에는 저장되지만 홈페이지, 글 목록, RSS에는 나오지 않습니다. 대표 이미지는
`src/assets/blog/`에 저장되어 Astro 이미지 파이프라인을 거칩니다.

## 로컬 확인

터미널 두 개에서 저장소 루트를 기준으로 각각 실행합니다.

```bash
npx decap-server
```

```bash
npm run dev
```

그런 다음 `http://localhost:4321/admin/index.html`에 접속합니다. Astro 개발 서버에서는
정적 폴더의 `index.html` 경로를 직접 사용하며, 운영 Nginx에서는 `/admin/`으로 접속합니다.
로컬 프록시는 현재 Git 저장소에 직접 연결되므로 테스트 중 저장을 누르면 실제 파일이
변경됩니다. 확인용 글은
**초안으로 숨기기**를 유지하고, 생성된 변경을 검토한 뒤 커밋합니다.

## 운영 인증

CMS는 GitHub 저장소 `jinhwan1030/jhwan.dev`와 `auth.jhwan.dev`의 Cloudflare Worker를
사용합니다. Worker 소스와 테스트는 `deploy/cloudflare/cms-oauth/`에 있으며, Client Secret은
저장소나 Docker 이미지에 넣지 않습니다.

### 1. GitHub OAuth App 만들기

GitHub **Settings → Developer settings → OAuth Apps → New OAuth App**에서 다음 값으로
만듭니다.

- Application name: `jhwan.dev CMS`
- Homepage URL: `https://jhwan.dev/admin/`
- Authorization callback URL: `https://auth.jhwan.dev/callback`

발급된 Client ID와 Client Secret은 다음 단계에서만 사용합니다. `jhwan.dev` 저장소는
공개 저장소이므로 CMS 설정과 Worker는 전체 비공개 저장소 권한이 아닌 `public_repo`
scope만 요청합니다. GitHub OAuth App의 scope는 특정 저장소 하나로 한정되지는 않으므로,
관리자용 OAuth App으로만 사용하고 불필요해지면 GitHub에서 폐기합니다.

### 2. Worker 최초 배포

```bash
cd deploy/cloudflare/cms-oauth
cp .dev.vars.example .dev.vars
```

`.dev.vars`에 방금 발급한 두 값을 입력합니다. 이 파일은 Git에서 제외됩니다.

```dotenv
GITHUB_OAUTH_ID="..."
GITHUB_OAUTH_SECRET="..."
```

Cloudflare 로그인 후 두 값을 암호화된 Worker Secret으로 함께 올리며 최초 배포합니다.

```bash
npx --yes wrangler@4.123.0 login
npm run deploy -- --secrets-file .dev.vars
```

`wrangler.jsonc`가 `auth.jhwan.dev`를 Worker Custom Domain으로 등록하므로 별도 원본 서버나
TLS 인증서가 필요하지 않습니다. 같은 이름의 기존 DNS 레코드가 있다면 최초 배포 전에
제거해야 합니다.

### 3. 이후 push 자동 배포

GitHub 저장소의 `cms-oauth` Environment 또는 Repository Secrets에 아래 값을 등록합니다.

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`: Cloudflare Workers 편집 권한을 가진 전용 토큰

두 값이 있으면 `.github/workflows/deploy-cms-oauth.yml`이 Worker 관련 변경을 테스트한 뒤
자동 배포합니다. 값이 아직 없으면 테스트만 통과하고 배포 단계는 안전하게 건너뜁니다.
Cloudflare에 저장된 `GITHUB_OAUTH_ID`와 `GITHUB_OAUTH_SECRET`은 이후 코드 배포에서도
유지됩니다.

### 4. 확인

```bash
curl --fail https://auth.jhwan.dev/health
```

`jhwan CMS OAuth proxy: ok`가 나오면 `https://jhwan.dev/admin/`에서 **Login with GitHub**를
선택합니다. 로그인한 GitHub 계정에 `jinhwan1030/jhwan.dev` 쓰기 권한이 있어야 글을
저장할 수 있습니다.
