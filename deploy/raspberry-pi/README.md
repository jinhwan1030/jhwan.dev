# jhwan.dev Raspberry Pi runtime

`compose.yml`은 `legyeseul/jhwan-homepage:latest`를 포트 `4321`에서 실행하고 홈페이지
응답을 healthcheck합니다.

운영 위치:

```text
/home/jinhwan/projects/jhwan-homepage/compose.yml
```

공통 자동 업데이터는 BabyWeather 저장소의
`scripts/install-auto-deploy.sh`로 최초 한 번 설치합니다. 이후에는 main push와 GitHub
Actions 이미지 빌드가 끝나면 라즈베리파이가 새 이미지를 자동으로 적용합니다.
