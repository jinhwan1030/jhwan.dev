---
title: '라즈베리파이로 DDNS + SSL + 자동배포까지 구축하기'
description: "도메인 하나 사고 라즈베리파이에 웹서버 올리기까지. DDNS, Nginx Proxy Manager, Let's Encrypt, GitHub Actions 전부 연결한 홈랩 구축기"
pubDate: '2026-05-17'
category: '홈랩'
---

## 구성 목표

도메인 하나를 사서 라즈베리파이에서 직접 웹서버를 운영하는 게 목표다. 클라우드 서버 없이, 집에 있는 라즈베리파이 4B로 아래 구성을 만들었다.

```
jhwan.dev
    ↓
Cloudflare DNS (DDNS)
    ↓
iptime 공유기 포트포워딩 (80, 443)
    ↓
라즈베리파이 4B
    ↓
Nginx Proxy Manager (리버스 프록시 + SSL)
    ↓
Docker 컨테이너 (Astro 포트폴리오)
```

## 준비물

- 라즈베리파이 4B (Raspberry Pi OS Lite 64bit)
- Cloudflare에 등록된 도메인
- Docker, Docker Compose 설치 완료
- iptime 공유기

## 1단계: Cloudflare DDNS 설정

집 인터넷은 유동 IP라 IP가 바뀌면 도메인이 끊긴다. Cloudflare API로 자동으로 IP를 갱신하는 스크립트를 만든다.

자세한 내용은 [Cloudflare API로 DDNS 스크립트 만들기](/blog/cloudflare-ddns) 참고.

```bash
# Cloudflare A 레코드 수동 생성 (처음 한 번만)
# Cloudflare 대시보드 → DNS → 레코드 추가
# 유형: A, 이름: @, IPv4: 아무 IP, 프록시: DNS 전용

# DDNS 스크립트 실행
bash {절대경로}/cf-ddns.sh

# cron 등록 (매분 실행)
sudo crontab -e
# 추가: * * * * * {절대경로}/cf-ddns.sh
```

## 2단계: 포트포워딩

iptime 공유기 관리자 페이지에서 포트포워딩을 설정한다.

- 고급 설정 → NAT/라우터 관리 → 포트포워딩
- 80 TCP → 라즈베리파이 내부 IP
- 443 TCP → 라즈베리파이 내부 IP

라즈베리파이 내부 IP 확인:
```bash
hostname -I
```

## 3단계: Nginx Proxy Manager 설치

Docker Compose로 NPM을 설치한다.

`docker-compose.yml`:
```yaml
services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    container_name: npm
    restart: unless-stopped
    ports:
      - "80:80"
      - "81:81"
      - "443:443"
    volumes:
      - {절대경로}/npm/data:/data
      - {절대경로}/npm/letsencrypt:/etc/letsencrypt
```

```bash
docker compose up -d
```

NPM 관리자 페이지는 `라즈베리파이IP:81`로 접속한다.
기본 계정: `admin@example.com` / `changeme`

## 4단계: SSL 인증서 발급

Let's Encrypt로 무료 SSL 인증서를 발급한다. 근데 http-01 방식은 외부에서 80포트로 접속해서 인증하는데, 국가별 접속 제한을 켜놨다면 Let's Encrypt 서버(미국)가 차단돼서 실패한다.

그래서 **Cloudflare DNS 인증 방식**을 사용한다. 외부 접속 없이 DNS TXT 레코드로 인증하기 때문에 국가 제한과 무관하다.

NPM → Proxy Hosts → Add Proxy Host:

- Domain Names: `jhwan.dev`
- Scheme: `http`
- Forward Hostname: `라즈베리파이 내부 IP`
- Forward Port: `컨테이너 포트`

SSL 탭:
- SSL Certificate: `Request a new SSL Certificate`
- DNS Challenge 체크
- DNS Provider: `Cloudflare`
- Credentials: `dns_cloudflare_api_token = {API_TOKEN}`
- Email 입력 후 Save

## 5단계: Docker로 웹서비스 배포

Astro 정적 사이트를 Docker로 빌드해서 올린다. 자세한 내용은 [GitHub Actions로 arm64 Docker 이미지 빌드하기](/blog/github-actions-arm64) 참고.

```bash
# 수동 배포 (처음 한 번)
docker pull {도커허브아이디}/이미지이름:latest
docker run -d --name portfolio -p 4321:80 --restart unless-stopped {도커허브아이디}/이미지이름:latest
```

이후에는 GitHub Actions가 자동으로 빌드하고, 라즈베리파이 cron이 매분 새 이미지를 확인해서 자동 배포한다.

## 보안 포인트

- **81포트(NPM 관리자), 9443포트(Portainer)는 포트포워딩하지 않는다.** 외부에서 접근할 수 없다.
- **SSH 22포트도 포트포워딩하지 않는다.** 원격 배포는 cron pull 방식으로 대체한다.
- **국가별 접속 제한**을 켜서 한국 IP만 허용한다.
- **NAS는 서브도메인으로 외부 노출하지 않는다.** WireGuard VPN으로만 접속한다.

## 마치며

클라우드 서버 없이 집 라즈베리파이로 웹서비스를 운영하는 게 가능하다. 전기세도 월 몇 천원 수준이고, 도메인 비용 외에 추가 비용이 없다. DDNS, 리버스 프록시, SSL, 자동배포까지 연결하고 나면 push 한 번으로 배포가 끝난다.
