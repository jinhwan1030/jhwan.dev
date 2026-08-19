# jhwan.dev Raspberry Pi runtime

`compose.yml`은 `legyeseul/jhwan-homepage:latest`의 Astro Node 서버를 호스트 포트 `4321`에서
실행하고 `/blog/` 응답으로 Node 런타임과 SQLite 초기화를 함께 healthcheck합니다. 컨테이너는
기존 Nginx 이미지와 같은 내부 포트 `80`을 유지해 Raspberry Pi의 기존 Compose와 호환됩니다.

현재 단계에서는 DB가 컨테이너의 `/app/.data`에 있으므로 이미지 재생성 시 현재 Markdown으로 다시
초기화됩니다. 데이터 손실을 막기 위해 관리자 API는 기본 비활성 상태입니다. 영구 볼륨과 자동
백업을 추가한 뒤에만 `JHWAN_ADMIN_ENABLED=true`를 설정합니다.

기존 콘텐츠·미디어 이전 도구는 준비되어 있지만 현재 임시 `/app/.data`에는 적용하지 않습니다.
다음 배포 구간에서 `/data/jhwan.db`와 `/data/uploads` 영구 경로를 연결하고 백업·복구 검증을 마친
뒤 `npm run db:migrate-legacy -- --apply ...`를 한 번 실행합니다.

운영 위치:

```text
/home/jinhwan/projects/jhwan-homepage/compose.yml
```

공통 자동 업데이터는 BabyWeather 저장소의
`scripts/install-auto-deploy.sh`로 최초 한 번 설치합니다. 이후에는 main push와 GitHub
Actions 이미지 빌드가 끝나면 라즈베리파이가 새 이미지를 자동으로 적용합니다.
