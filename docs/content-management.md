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

CMS 설정은 GitHub 저장소 `jinhwan1030/jhwan.dev`와 `auth.jhwan.dev` OAuth 프록시를
사용하도록 준비되어 있습니다. 운영 로그인을 사용하려면 GitHub OAuth App과 Cloudflare
Worker에 Client ID와 Client Secret을 연결해야 합니다. 비밀값은 저장소나 Docker 이미지에
넣지 않습니다.
