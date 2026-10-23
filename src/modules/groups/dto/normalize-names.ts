// 종목 이름 정리: 앞뒤 공백 제거 + 연속 공백을 1개로 (문자열이 아니면 그대로 두어 검증이 400 처리)
export const normalizeName = (value: unknown) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

// 이름 배열의 각 요소를 정리하는 class-transformer Transform 콜백
export const normalizeNames = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map(normalizeName) : value;
