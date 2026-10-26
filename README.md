# sporit-backend
[sporit] 운동인을 위한 기록 공유 어플

## 환경 변수

`.env.example`을 복사해 `.env`를 만든다.

| 변수 | 설명 |
| --- | --- |
| `DATABASE_URL` | Railway PostgreSQL 연결 주소. **배포 서버는 Railway 내부 주소**(`*.railway.internal`), **로컬은 외부(public) 주소**(`*.proxy.rlwy.net`)를 사용한다. 내부 주소는 Railway 네트워크 안에서만 접속된다 |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` | 인증(Auth)과 Storage는 계속 Supabase를 사용한다 |

DB에는 `public` 스키마만 있고 Supabase `auth` 스키마는 없다. `profiles.id`는 Supabase 유저 ID와 같은 값이지만 `auth.users`로의 외래키는 없으므로, 회원 탈퇴 시 `profiles` 행을 먼저 지우고 Supabase 계정을 삭제한다.
