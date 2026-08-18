# jhwan.dev

> 개인 포트폴리오 & 블로그 — [jhwan.dev](https://jhwan.dev)

Astro 기반 정적 사이트. 라즈베리파이 홈서버에서 Docker로 운영 중.

## Stack

- **Framework**: [Astro](https://astro.build)
- **Styling**: Tailwind CSS
- **Deployment**: Docker + Raspberry Pi 4B
- **CI/CD**: GitHub Actions → Docker Hub → systemd 자동 배포
- **Proxy**: Nginx Proxy Manager + Let's Encrypt SSL
- **DNS**: Cloudflare (DDNS)

## Project Structure

```
src/
├── assets/           # 이미지, 폰트
├── components/       # 공통 컴포넌트 (Header, Footer 등)
├── content/
│   └── blog/         # 블로그 포스트 (.md)
├── layouts/
│   └── BlogPost.astro
├── pages/
│   ├── index.astro   # 홈
│   ├── about.astro   # 소개
│   ├── blog/         # 블로그 목록/상세
│   └── rss.xml.js    # RSS 피드
└── styles/
    └── global.css
public/
└── admin/            # Decap CMS 글 관리 화면과 콘텐츠 스키마
```

## Dev

```bash
npm install
npm run dev       
npm run build     # ./dist/ 빌드
npm run preview   # 빌드 미리보기
```

## Content Management

글은 `/admin/`의 Decap CMS에서 작성하고, GitHub에 저장된 Markdown을 Astro가 빌드합니다.
새 글은 기본적으로 초안이어서 공개 전 검토할 수 있습니다. 로컬 사용법과 게시 흐름은
[`docs/content-management.md`](./docs/content-management.md)에 정리되어 있습니다.

## Deployment

`main` 브랜치에 push하면 GitHub Actions가 멀티플랫폼 Docker 이미지를 빌드해 Docker Hub에 올린다.
운영 이미지 이름은 `legyeseul/jhwan-homepage`이며, `latest`와 롤백 가능한 커밋별 태그를 함께 발행한다.

라즈베리파이의 운영 컨테이너를 새 이미지로 옮기기 전까지는
`legyeseul/jhwan-portfolio:latest`도 임시로 함께 발행한다.

```
push to main
  → GitHub Actions (linux/amd64, linux/arm64 멀티플랫폼 빌드)
  → Docker Hub (legyeseul/jhwan-homepage:latest, sha-<commit>)
  → Raspberry Pi systemd pull, healthcheck & rollback
```

운영 Compose 원본은 [`deploy/raspberry-pi/compose.yml`](./deploy/raspberry-pi/compose.yml)에
있습니다. 공통 자동 업데이터와 최초 설치기는 BabyWeather 저장소에서 관리합니다.
