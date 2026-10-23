// KST(UTC+9) 기준 날짜 계산 유틸

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 현재 시각을 KST 기준 "날짜만" 담은 Date로 변환 (@db.Date 컬럼 저장/비교용, UTC 자정 값으로 표현)
export function getKstToday(): Date {
  const kstNow = new Date(Date.now() + KST_OFFSET_MS);
  return new Date(
    Date.UTC(
      kstNow.getUTCFullYear(),
      kstNow.getUTCMonth(),
      kstNow.getUTCDate(),
    ),
  );
}

// getKstToday()가 반환한 형태의 날짜에서 days일 전 날짜
export function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * DAY_MS);
}

// "YYYY-MM-DD" 쿼리 문자열을 getKstToday()와 같은 형태(KST 날짜, UTC 자정 값)로 파싱. 형식이 잘못되면 null
export function parseKstDate(dateStr: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const isValid =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);

  return isValid ? date : null;
}

// getKstToday() 형태의 KST 날짜를 실제 UTC 타임스탬프 범위([start, end))로 변환 (timestamptz 컬럼을 KST 날짜로 조회할 때 사용)
export function kstDateToUtcRange(kstDate: Date): { start: Date; end: Date } {
  const start = new Date(kstDate.getTime() - KST_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

// getKstToday() 형태의 날짜에서 days일 후 날짜
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

// getKstToday() 형태의 날짜가 속한 주의 월요일 (주는 월요일 시작~일요일 끝)
export function getKstWeekStart(date: Date): Date {
  const daysSinceMonday = (date.getUTCDay() + 6) % 7; // 월=0 ... 일=6
  return subtractDays(date, daysSinceMonday);
}

// getKstToday() 형태의 날짜를 "YYYY-MM-DD" 문자열로 변환 (parseKstDate의 역변환)
export function formatKstDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
