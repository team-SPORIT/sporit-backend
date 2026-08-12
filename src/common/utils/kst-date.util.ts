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

// 시간을 무시하고 두 날짜가 같은 날인지 비교
export function isSameDate(a: Date, b: Date): boolean {
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
}
