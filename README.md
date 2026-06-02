# jhwan.dev

> 개인 포트폴리오 & 블로그 — [jhwan.dev](https://jhwan.dev)

Astro 기반 정적 사이트. 라즈베리파이 홈서버에서 Docker로 운영 중.

## Stack

- **Framework**: [Astro](https://astro.build)
- **Styling**: Tailwind CSS
- **Deployment**: Docker + Raspberry Pi 4B
- **CI/CD**: GitHub Actions → Docker Hub → cron pull
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
```

## Dev

```bash
npm install
npm run dev       # localhost:4321
npm run build     # ./dist/ 빌드
npm run preview   # 빌드 미리보기
```

## Deployment

`main` 브랜치에 push하면 GitHub Actions가 Docker 이미지를 빌드해 Docker Hub에 올린다.
라즈베리파이에서 1분마다 cron이 새 이미지를 감지하면 자동으로 업데이트한다.

```
push to main
  → GitHub Actions (linux/amd64, linux/arm64 멀티플랫폼 빌드)
  → Docker Hub (legyeseul/jhwan-portfolio:latest)
  → Raspberry Pi cron pull & restart
```
