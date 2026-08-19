# jhwan.dev

> 개인 포트폴리오 & 블로그 — [jhwan.dev](https://jhwan.dev)

Astro Node 기반 개인 홈페이지와 SQLite 블로그. 라즈베리파이 홈서버에서 Docker로 운영 중.

## Stack

- **Framework**: [Astro](https://astro.build) SSR + 공식 Node 어댑터
- **Content DB**: SQLite (`node:sqlite`)
- **Styling**: Tailwind CSS
- **Deployment**: Docker + Raspberry Pi 4B
- **CI/CD**: GitHub Actions → Docker Hub → systemd 자동 배포
- **Admin**: 자체 Content Studio + GitHub OAuth + Cloudflare Worker (운영 전환 준비 중)
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
└── admin/            # 전환 전 Sveltia CMS 운영 화면
admin/                # 새 Content Studio 독립 프런트엔드
database/             # SQLite 스키마 마이그레이션
```

## Dev

```bash
npm install
npm run dev       
npm run build     # ./dist/ 빌드
npm run preview   # 빌드 미리보기
```

## Content Management

현재 운영 `/admin/`은 전환 안전망으로 Sveltia CMS를 유지합니다. 홈페이지 런타임은 빈 SQLite를
현재 Markdown으로 한 번 초기화한 뒤 목록·상세·RSS·사이트맵을 DB에서 즉시 렌더링합니다. 영구
볼륨과 백업을 적용한 뒤 새 Content Studio를 운영 `/admin/`에 연결합니다. 기존 게시 흐름은
[`docs/content-management.md`](./docs/content-management.md)에 정리되어 있습니다.

## Deployment

`main` 브랜치에 push하면 GitHub Actions가 멀티플랫폼 Docker 이미지를 빌드해 Docker Hub에 올린다.
운영 이미지 이름은 `legyeseul/jhwan-homepage`이며, `latest`와 롤백 가능한 커밋별 태그를 함께 발행한다.

```
push to main
  → GitHub Actions (linux/amd64, linux/arm64 멀티플랫폼 빌드)
  → Docker Hub (legyeseul/jhwan-homepage:latest, sha-<commit>)
  → Raspberry Pi systemd pull, healthcheck & rollback
```

운영 Compose 원본은 [`deploy/raspberry-pi/compose.yml`](./deploy/raspberry-pi/compose.yml)에
있습니다. 공통 자동 업데이터와 최초 설치기는 BabyWeather 저장소에서 관리합니다.
