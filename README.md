# jhwan.dev

> 개인 포트폴리오 & 블로그 — [jhwan.dev](https://jhwan.dev)

Astro Node 기반 개인 홈페이지와 SQLite 블로그. 라즈베리파이 홈서버에서 Docker로 운영 중.

## Stack

- **Framework**: [Astro](https://astro.build) SSR + 공식 Node 어댑터
- **Content DB**: SQLite (`node:sqlite`)
- **Styling**: Tailwind CSS
- **Deployment**: Docker + Raspberry Pi 4B
- **CI/CD**: GitHub Actions → Docker Hub → systemd 자동 배포
- **Admin**: 자체 Content Studio + GitHub OAuth + Cloudflare Worker
- **Proxy**: Nginx Proxy Manager + Let's Encrypt SSL
- **DNS**: Cloudflare (DDNS)

## Project Structure

```
src/
├── assets/           # 이미지, 폰트
├── components/       # 공통 컴포넌트 (Header, Footer 등)
├── content/
│   └── blog/         # 최초 DB 이전용 Markdown seed
├── layouts/
│   └── BlogPost.astro
├── pages/
│   ├── index.astro   # 홈
│   ├── about.astro   # 소개
│   ├── blog/         # 블로그 목록/상세
│   └── rss.xml.js    # RSS 피드
└── styles/
    └── global.css
admin/                # 운영 Content Studio 프런트엔드
database/             # SQLite 스키마 마이그레이션
scripts/              # 콘텐츠·미디어 이전 및 운영 검증 도구
```

## Dev

```bash
npm install
npm run dev       
npm run build     # ./dist/ 빌드
npm run preview   # 빌드 미리보기
```

## Content Management

운영 `/admin/`은 자체 Content Studio입니다. GitHub OAuth로 관리자 본인만 확인하며, 글과 이미지는
Raspberry Pi의 영속 SQLite·업로드 디렉터리에 직접 저장됩니다. 저장한 글은 Git 커밋이나 이미지
재빌드를 기다리지 않고 다음 요청부터 목록·상세·RSS·사이트맵에 반영됩니다. 게시 흐름과 인증 설정은
[`docs/content-management.md`](./docs/content-management.md)에 정리되어 있습니다.

기존 Markdown과 `src/assets/blog` 이미지는 `npm run db:migrate-legacy`로 쓰기 없는 사전 검사를
할 수 있습니다. 운영에서는 컨테이너 entrypoint가 비어 있는 영속 저장소에 한 번만 적용하며,
첫 검증 백업 전에는 관리자 쓰기를 열지 않습니다. 세부 절차는
[`docs/content-database.md`](./docs/content-database.md)에 정리되어 있습니다.

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
있습니다. `./data`에 DB·업로드를 영속화하고 매일 검증 백업을 14개 보존합니다. 공통 자동
업데이터와 최초 설치기는 BabyWeather 저장소에서 관리합니다.
