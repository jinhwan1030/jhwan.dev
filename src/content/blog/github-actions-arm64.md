---
title: 'GitHub Actions로 arm64 Docker 이미지 빌드하기'
description: '라즈베리파이에 배포하려면 arm64 빌드가 필요하다. 플랫폼 불일치로 컨테이너가 재시작 루프에 빠진 삽질기'
pubDate: '2026-05-17'
category: '홈랩'
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

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: QEMU 설정
        uses: docker/setup-qemu-action@v3

      - name: Buildx 설정
        uses: docker/setup-buildx-action@v3

      - name: Docker Hub 로그인
        uses: docker/login-action@v3
        with:
          username: 여기에_도커허브_아이디
          password: ${{ secrets.DOCKER_PASSWORD }}

      - name: 빌드 & Push
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: 도커허브아이디/이미지이름:latest
```

핵심은 `platforms: linux/amd64,linux/arm64` 이 한 줄이다. 두 플랫폼을 동시에 빌드해서 Docker Hub에 올린다.

## Dockerfile

Astro 정적 사이트를 nginx로 서빙하는 멀티스테이지 빌드다:

```dockerfile
FROM node:lts-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
```

빌드 스테이지에서 Node.js로 Astro를 빌드하고, 결과물만 nginx 이미지에 복사한다. 라즈베리파이에 Node.js를 설치할 필요가 없다.

## 라즈베리파이 자동 배포

SSH 배포를 쓰면 되지만, 국가별 접속 제한을 켜놨다면 GitHub Actions 서버(미국)가 차단된다. 그래서 cron pull 방식을 택했다.

라즈베리파이에 업데이트 스크립트를 만들고:

```bash
#!/bin/bash

LOG=/var/log/portfolio-update.log
FAIL_LOG=/var/log/portfolio-fail.log
DATE=$(date "+%Y-%m-%d %H:%M:%S KST")

CURRENT=$(docker inspect --format='{{.Image}}' portfolio 2>/dev/null)
docker pull 도커허브아이디/이미지이름:latest >> /dev/null 2>&1

NEW=$(docker inspect --format='{{.Id}}' 도커허브아이디/이미지이름:latest)

if [ "$CURRENT" == "$NEW" ]; then
  exit 0
fi

echo "[$DATE] 새 이미지 감지, 업데이트 중..." >> $LOG
docker stop portfolio >> /dev/null 2>&1
docker rm portfolio >> /dev/null 2>&1
docker run -d --name portfolio -p 4321:80 --restart unless-stopped 도커허브아이디/이미지이름:latest >> /dev/null 2>&1

if [ $? -ne 0 ]; then
  echo "[$DATE] FAIL: 컨테이너 실행 실패" >> $FAIL_LOG
else
  echo "[$DATE] 업데이트 완료" >> $LOG
fi
```

cron에 매분 실행 등록:

```bash
* * * * * /{절대경로로}/update-portfolio.sh
```

push하면 Actions가 빌드 & Docker Hub push → 라즈베리파이가 매분 새 이미지 확인 → 변경됐으면 자동 배포. 최대 1분 안에 반영된다.

## 빌드 시간

멀티플랫폼 빌드는 단일 플랫폼보다 시간이 훨씬 오래 걸린다. amd64만 빌드하면 1~2분이지만, arm64까지 추가하면 10~20분 걸린다. QEMU로 에뮬레이션해서 빌드하기 때문이다.

## 마치며

플랫폼 불일치는 처음엔 원인을 찾기 어렵다. 컨테이너가 실행은 되는데 바로 재시작되니까 로그를 잘 봐야 한다. `platforms: linux/amd64,linux/arm64` 한 줄로 해결되니까 라즈베리파이에 배포할 때는 꼭 추가하자.
