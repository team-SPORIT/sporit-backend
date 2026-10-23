import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
// anon key가 없으면 service_role 키로 대체 (GoTrue 로그인은 둘 다 유효한 apikey면 동작)
const publicKey = process.env.SUPABASE_ANON_KEY ?? serviceRoleKey;

// 관리자 권한 클라이언트: 테스트 유저 생성/삭제용 (service_role)
const adminClient = createClient(supabaseUrl, serviceRoleKey);
// 일반 클라이언트: 실제 로그인 흐름 재현용 (anon 또는 service_role)
const authClient = createClient(supabaseUrl, publicKey);

// Supabase Auth는 짧은 시간에 요청이 몰리면 "Request rate limit reached"를 돌려준다.
// E2E 스위트가 병렬로 많은 유저를 만들고 로그인하므로, 이 에러일 때만 잠시 기다렸다가 재시도한다
const RATE_LIMIT_RETRIES = 6;

async function withRateLimitRetry<
  T extends { error: { message: string } | null },
>(call: () => Promise<T>): Promise<T> {
  let result = await call();
  for (
    let attempt = 1;
    attempt <= RATE_LIMIT_RETRIES &&
    result.error?.message.toLowerCase().includes('rate limit');
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    result = await call();
  }
  return result;
}

// 이메일/비번으로 테스트 유저 생성 (email_confirm: true로 즉시 로그인 가능하게)
export async function createTestUser(
  email: string,
  password: string,
): Promise<{ id: string; email: string }> {
  const { data, error } = await withRateLimitRetry(() =>
    adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    }),
  );

  if (error || !data.user) {
    throw new Error(
      `테스트 유저 생성 실패(${email}): ${error?.message ?? '알 수 없는 오류'}`,
    );
  }

  return { id: data.user.id, email };
}

// 이메일/비번으로 로그인해 access_token 발급
export async function getAccessToken(
  email: string,
  password: string,
): Promise<string> {
  const { data, error } = await withRateLimitRetry(() =>
    authClient.auth.signInWithPassword({ email, password }),
  );

  if (error || !data.session) {
    throw new Error(
      `테스트 유저 로그인 실패(${email}): ${error?.message ?? '알 수 없는 오류'}`,
    );
  }

  return data.session.access_token;
}

// 테스트 유저 삭제 (정리용). 실패해도 다른 정리 작업을 막지 않도록 에러를 삼킨다
export async function deleteTestUser(userId: string): Promise<void> {
  await adminClient.auth.admin.deleteUser(userId).catch(() => undefined);
}
