---
title: 'Cloudflare API로 DDNS 스크립트 만들기'
description: 'dns/records가 아니라 dns_records였다.. 언더스코어 하나에 1시간 날린 삽질기'
pubDate: '2026-05-17'
category: '홈랩'
---

## 시작하기 전에

집에서 홈서버를 운영하다 보면 가장 먼저 부딪히는 문제가 바로 **유동 IP**다. KT, SKT 같은 ISP는 공인 IP를 고정으로 주지 않기 때문에, 언제 IP가 바뀔지 모른다. 그래서 필요한 게 DDNS(Dynamic DNS)다.

Cloudflare에 도메인이 있다면 API를 활용해서 직접 DDNS 스크립트를 만들 수 있다. 근데 여기서 삽질을 좀 했다.

## Cloudflare API 토큰 발급

먼저 Cloudflare 대시보드에서 API 토큰을 발급해야 한다.

1. [dash.cloudflare.com](https://dash.cloudflare.com) 접속
2. 우측 상단 프로필 → My Profile → API Tokens
3. Create Token → **Edit zone DNS** 템플릿 선택
4. Zone Resources에서 도메인 선택 후 발급

토큰은 발급 후 **딱 한 번만** 보여주니까 반드시 복사해두자.

## Zone ID 확인

Cloudflare 대시보드에서 도메인 클릭 → 우측 사이드바 하단 **영역 ID** 복사.

## 스크립트 작성

```bash
nano ~/cf-ddns.sh
```

```bash
#!/bin/bash

CF_API_TOKEN="여기에_토큰"
ZONE_ID="여기에_영역ID"
RECORD_NAME="jhwan.dev"

LOG=/var/log/cf-ddns.log
FAIL_LOG=/var/log/cf-ddns-fail.log
DATE=$(date "+%Y-%m-%d %H:%M:%S KST")

CURRENT_IP=$(curl -s https://api.ipify.org)

if [ -z "$CURRENT_IP" ]; then
  echo "[$DATE] FAIL: 공인 IP 조회 실패" >> $FAIL_LOG
  exit 1
fi

RESPONSE=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=A&name=$RECORD_NAME" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json")

RECORD_ID=$(echo $RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin)['result'][0]['id'])" 2>/dev/null)

if [ -z "$RECORD_ID" ]; then
  echo "[$DATE] FAIL: Record ID 조회 실패" >> $FAIL_LOG
  exit 1
fi

PREV_IP=$(echo $RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin)['result'][0]['content'])" 2>/dev/null)

if [ "$CURRENT_IP" == "$PREV_IP" ]; then
  exit 0
fi

RESULT=$(curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{\"content\":\"$CURRENT_IP\"}")

SUCCESS=$(echo $RESULT | python3 -c "import sys,json; print(json.load(sys.stdin)['success'])" 2>/dev/null)

if [ "$SUCCESS" == "True" ]; then
  echo "[$DATE] IP 변경: $PREV_IP → $CURRENT_IP" >> $LOG
else
  echo "[$DATE] FAIL: IP 업데이트 실패 ($CURRENT_IP)" >> $FAIL_LOG
fi
```

## 삽질 포인트 🔥

여기서 한 시간을 날렸다.

Cloudflare API 공식 문서를 보면 엔드포인트가 이렇게 나온다: /zones/{zone_id}/dns/records

근데 실제로 요청하면 이런 에러가 난다:

```json
{
  "errors": [{
    "code": 7003,
    "message": "Could not route to /zones/.../dns/records"
  }]
}
```

Zone ID도 맞고, 토큰도 맞고, 권한도 맞는데 계속 에러가 났다. 원인은 황당하게도 **슬래시(/)가 아니라 언더스코어(_)** 였다.

❌ /zones/{zone_id}/dns/records
✅ /zones/{zone_id}/dns_records

`dns/records`가 아니라 `dns_records`다. 이걸 찾는 데 한 시간이 걸렸다.

## cron 등록

```bash
sudo crontab -e
```

* * * * * /home/닉네임/cf-ddns.sh

매분마다 실행해서 IP가 바뀌면 자동으로 업데이트된다. IP가 바뀌지 않으면 로그를 남기지 않아서 깔끔하다.

## 마치며

Cloudflare DDNS는 생각보다 간단하다. API 토큰 발급하고 스크립트 작성하면 끝이다. 근데 `dns_records` 언더스코어 하나 때문에 한 시간을 날렸다. 공식 문서가 틀린 건지, 버전 차이인지 모르겠지만 삽질한 내용이니까 기록해둔다.