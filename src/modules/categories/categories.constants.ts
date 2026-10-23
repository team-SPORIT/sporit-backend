// 카테고리 색상 팔레트 키. DB에는 이 키 문자열을 저장하고 서비스(DTO)에서 검증한다
export const CATEGORY_COLORS = [
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'teal',
  'sky',
  'blue',
  'indigo',
  'purple',
  'pink',
  'gray',
] as const;

export type CategoryColor = (typeof CATEGORY_COLORS)[number];

// 사용자당 최대 카테고리 수
export const MAX_CATEGORIES_PER_USER = 20;

// 카테고리 이름 길이 (DB varchar(20))
export const CATEGORY_NAME_MAX_LENGTH = 20;

// 종목 이름 길이 (DB varchar(30))와 한 번에 매핑할 수 있는 최대 종목 수
export const EXERCISE_NAME_MAX_LENGTH = 30;
export const MAX_EXERCISE_NAMES_PER_REQUEST = 100;
