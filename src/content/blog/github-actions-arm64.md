---
title: 'GitHub Actions로 arm64 Docker 이미지 빌드하기'
description: '라즈베리파이에 배포하려면 arm64 빌드가 필요하다. 플랫폼 불일치로 컨테이너가 재시작 루프에 빠진 삽질기'
pubDate: '2026-05-17'
updatedDate: '2026-08-19'
category: '홈랩'
draft: false
---

## 문제 상황

GitHub Actions에서 Docker 이미지를 빌드하고 라즈베리파이에 배포했더니 컨테이너가 계속 재시작됐다.

```
STATUS: Restarting (255) 3 seconds ago
WARNING: The requested image's platform (linux/amd64) does not match the detected host platform (linux/arm64/v8)
```

원인은 간단했다. GitHub Actions 러너는 `amd64` 환경이고, 라즈베리파이는 `arm64` 환경이다. 플랫폼이 달라서 실행이 안 된 것이다.

## 해결 방법: 멀티플랫폼 빌드

QEMU와 Buildx를 활용하면 amd64 환경에서 arm64 이미지를 빌드할 수 있다.

## workflow 파일 작성

`.github/workflows/deploy.yml`:

```yaml
name: Deploy to Raspberry Pi

on:
  push:
    branches:
      - main

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: QEMU 설정
        uses: docker/setup-qemu-action@v4

      - name: Buildx 설정
        uses: docker/setup-buildx-action@v4

      - name: Docker Hub 로그인
        uses: docker/login-action@v4
        with:
          username: 여기에_도커허브_아이디
          password: ${{ secrets.DOCKER_PASSWORD }}

      - name: 빌드 & Push
        uses: docker/build-push-action@v7
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            도커허브아이디/이미지이름:latest
            도커허브아이디/이미지이름:sha-${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

핵심은 `platforms: linux/amd64,linux/arm64`다. 두 플랫폼을 같은 태그로 묶어 Docker Hub에
올리고, 운영용 `latest`와 복구 가능한 커밋별 태그를 함께 발행한다.

## Dockerfile

Astro 정적 사이트를 nginx로 서빙하는 멀티스테이지 빌드다:

```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
```

빌드 스테이지에서 Node.js로 Astro를 빌드하고, 결과물만 nginx 이미지에 복사한다. 라즈베리파이에 Node.js를 설치할 필요가 없다.

## 라즈베리파이 자동 배포

초기에는 cron과 `docker run`을 조합했지만, 컨테이너 생성에는 성공해도 애플리케이션이
정상 응답하는지 판단하기 어렵고 실패 시 자동 복구도 없었다. 현재는 Compose 파일을 배포
단위로 두고 systemd timer가 라즈베리파이 안에서 새 이미지를 확인한다.

```text
main push
  → GitHub Actions 검증 및 멀티플랫폼 이미지 발행
  → Raspberry Pi systemd timer의 outbound pull
  → docker compose pull/up
  → 홈페이지 healthcheck
  → 성공 또는 직전 이미지로 자동 rollback
```

홈페이지 Compose에는 운영 이미지와 healthcheck를 함께 선언한다.

```yaml
services:
  homepage:
    image: legyeseul/jhwan-homepage:latest
    container_name: jhwan-homepage
    restart: unless-stopped
    ports:
      - "4321:80"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1/ >/dev/null || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3
```

업데이터는 홈페이지와 BabyWeather Compose 스택을 함께 확인하고, 새 버전이 정상화되지
않으면 업데이트 직전의 로컬 이미지로 태그를 되돌린다. GitHub Actions가 홈서버에 접속하는
방식이 아니라 라즈베리파이가 이미지를 가져오는 구조라 외부에 SSH 포트를 열 필요도 없다.
현재 설치와 복구 절차는
[BabyWeather 배포 가이드](https://github.com/jinhwan1030/babyweather/blob/main/docs/operations/deployment.md)에
한곳으로 모아 관리한다.

## 빌드 시간

멀티플랫폼 빌드는 QEMU 에뮬레이션 때문에 단일 플랫폼 빌드보다 오래 걸릴 수 있다.
GitHub Actions 캐시를 연결하면 의존성과 변경되지 않은 이미지 레이어를 재사용해 반복 빌드
시간을 줄일 수 있다.

## 마치며

플랫폼 불일치는 처음엔 원인을 찾기 어렵다. 컨테이너가 실행은 되는데 바로 재시작되니까 로그를 잘 봐야 한다. `platforms: linux/amd64,linux/arm64` 한 줄로 해결되니까 라즈베리파이에 배포할 때는 꼭 추가하자.
