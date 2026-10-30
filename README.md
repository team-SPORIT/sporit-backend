# sporit-backend
[sporit] 운동인을 위한 기록 공유 어플

## 환경 변수

`.env.example`을 복사해 `.env`를 만든다.

| 변수 | 설명 |
| --- | --- |
| `DATABASE_URL` | Railway PostgreSQL 연결 주소. **배포 서버는 Railway 내부 주소**(`*.railway.internal`), **로컬은 외부(public) 주소**(`*.proxy.rlwy.net`)를 사용한다. 내부 주소는 Railway 네트워크 안에서만 접속된다 |
| `DB_POOL_IDLE_MS`, `DB_POOL_MAX` | (선택) DB 커넥션 풀 설정. 놀고 있는 연결을 닫기까지의 시간(ms, 기본 `300000`=5분)과 최대 연결 수(기본 `10`). 풀은 keep-alive를 켜고 최소 1개 연결을 유지해, 요청이 뜸할 때 첫 요청이 재연결 때문에 느려지는 것을 줄인다 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | 인증(Auth)은 계속 Supabase를 사용한다 |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | 이미지 저장소(Railway Buckets, S3 호환, 비공개 버킷). `S3_REGION`은 `auto` |
| `S3_URL_EXPIRES_SEC` | (선택) 이미지 presigned URL 만료 시간(초). 기본 `3600` |
| `S3_FORCE_PATH_STYLE` | (선택) 버킷 접속이 안 될 때 `true`로 바꿔 시도한다(path-style 주소). 기본 `false` |
| `SLOW_REQUEST_MS` | (선택) 응답 시간이 이 값(ms) 이상인 요청을 `[SLOW]` 경고로 표시한다. 기본 `500` |
| `SLOW_QUERY_MS` | (선택) 이 값(ms) 이상 걸린 DB 쿼리를 `[SLOW QUERY]` 경고로 남긴다. 기본 `200` |

DB에는 `public` 스키마만 있고 Supabase `auth` 스키마는 없다. `profiles.id`는 Supabase 유저 ID와 같은 값이지만 `auth.users`로의 외래키는 없으므로, 회원 탈퇴 시 `profiles` 행을 먼저 지우고 Supabase 계정을 삭제한다.

## 이미지 저장소

프로필/기록 이미지는 Railway Bucket(비공개)에 저장한다.

- DB(`profiles.profile_image`, `records.start_image_url`/`end_image_url`)에는 공개 URL이 아니라 **object key**(`profiles/{userId}/{uuid}.jpg`, `records/{userId}/{uuid}-start.jpg`)를 저장한다.
- API 응답에서는 key를 **presigned GET URL**(기본 1시간 후 만료, `S3_URL_EXPIRES_SEC`)로 바꿔서 내려준다. 필드 이름은 그대로(`profile_image`, `startImageUrl` 등)이며, 만료되면 API를 다시 호출해 새 URL을 받아야 한다.
- `http(s)://`로 시작하는 값(소셜 로그인 아바타, 아직 이전하지 않은 Supabase URL)은 변환 없이 그대로 내려간다.

### 기존 Supabase 이미지 이전

기존 Supabase Storage 이미지를 새 버킷으로 옮기고 DB 값을 key로 바꾼다. 이미 key인 값은 건너뛰므로 다시 실행해도 안전하다. Supabase 원본은 지우지 않는다.

```bash
npm run migrate:storage -- --dry-run   # 대상만 출력 (업로드/DB 변경 없음)
npm run migrate:storage                # 실제 이전
```

## 성능 로그

서버 성능 확인용 로그를 남긴다. `NODE_ENV=test`(E2E)에서는 꺼진다.

- **요청 로그**: 요청마다 `GET /groups 200 123ms` (메서드, 쿼리스트링 제외 경로, 상태코드, 소요시간). `SLOW_REQUEST_MS` 이상이면 `warn`으로 `[SLOW]`가 붙는다. `GET /`와 Swagger(`/api-docs`)는 제외한다. 인증 가드에서 거절된 401과 존재하지 않는 경로의 404는 기록되지 않는다.
- **느린 쿼리 로그**: `SLOW_QUERY_MS` 이상 걸린 쿼리를 `[SLOW QUERY] 312ms SELECT ...` 로 `warn` 출력한다. 쿼리는 `$1` 같은 자리표시자 형태이며 파라미터 값은 남기지 않는다.
- Authorization 헤더, 요청 body, 쿼리스트링은 로그에 남기지 않는다.
