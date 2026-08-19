# 콘텐츠 DB 전환 기반

> 현재 실서비스는 여전히 `src/content/blog`의 Markdown을 정적 빌드합니다. 이 문서는 DB 전환을
> 안전하게 준비하기 위한 개발용 기반을 설명하며, 아직 운영 DB를 만들거나 사용하지 않습니다.

## 구성

- 런타임: Node.js 24.15 이상에 포함된 `node:sqlite`
- 마이그레이션: `database/migrations/*.sql`
- 기본 개발 경로: `.data/jhwan.db` (Git 제외)
- 운영 경로: 이후 Raspberry Pi의 Docker 영구 볼륨으로 별도 지정
- 보호 장치: 외래 키, WAL, 무결성 검사, 마이그레이션 체크섬, 쓰기 트랜잭션

DB에는 게시글 본문과 메타데이터, 수정 이력, 미디어 메타데이터만 저장합니다. 이미지 파일 자체는
DB BLOB으로 넣지 않고 이후 영구 업로드 볼륨에 저장합니다.

## 검사

현재 Markdown이 DB 레코드로 변환 가능한지만 검사합니다. DB 파일을 만들지 않습니다.

```bash
npm run db:import
```

SQLite 기반 회귀 테스트는 임시 디렉터리와 메모리 DB만 사용합니다.

```bash
npm run test:db
```

## 명시적 로컬 적용

마이그레이션과 가져오기는 실수로 운영 데이터를 변경하지 않도록 대상 경로를 반드시 요구합니다.

```bash
npm run db:migrate -- --database .data/jhwan.db
npm run db:import -- --apply --database .data/jhwan.db
```

같은 Markdown을 다시 가져오면 체크섬이 같은 글은 건너뜁니다. 내용이 바뀐 글만 새 버전으로
갱신하고 `post_revisions`에 스냅샷을 남깁니다. 같은 slug가 다른 원본 경로에 이미 연결되어 있으면
전체 가져오기를 롤백합니다.
