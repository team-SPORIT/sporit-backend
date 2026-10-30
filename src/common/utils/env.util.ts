// 환경변수 문자열을 양의 정수로 읽는다. 비었거나 숫자가 아니거나 0 이하이면 기본값을 쓴다
export function readPositiveInt(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// 테스트(NODE_ENV=test, jest가 자동으로 설정)에서는 타이밍 로그를 끈다
export function isTimingLogEnabled(): boolean {
  return process.env.NODE_ENV !== 'test';
}
