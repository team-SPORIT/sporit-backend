// 앱 공통 색상 팔레트. 카테고리와 그룹의 색상은 DB에 key 문자열만 저장하고, hex는 응답에서 이 상수로 내려준다
export const PALETTE = [
  { key: 'rose', hex: '#FF0060' },
  { key: 'coral', hex: '#DE5959' },
  { key: 'red', hex: '#D21417' },
  { key: 'crimson', hex: '#E63946' },
  { key: 'orange', hex: '#F6850C' },
  { key: 'amber', hex: '#E57300' },
  { key: 'yellow', hex: '#FFC300' },
  { key: 'lime', hex: '#97BF16' },
  { key: 'sky', hex: '#39B1D1' },
  { key: 'blue', hex: '#0079FF' },
  { key: 'purple', hex: '#7B2CBF' },
  { key: 'black', hex: '#202020' },
] as const;

export type PaletteKey = (typeof PALETTE)[number]['key'];

// 팔레트 key 목록 (DTO 검증 @IsIn, Swagger enum 용)
export const PALETTE_KEYS: PaletteKey[] = PALETTE.map(({ key }) => key);

// 팔레트에 있는 key인지 확인
export function isPaletteKey(key: unknown): key is PaletteKey {
  return PALETTE_KEYS.includes(key as PaletteKey);
}

// key에 해당하는 hex. 팔레트에 없는 key(예: 이전 팔레트의 값)면 null
export function getColorHex(key: string | null | undefined): string | null {
  return PALETTE.find((color) => color.key === key)?.hex ?? null;
}

// 팔레트에서 무작위 key 하나 (그룹 생성 시 색 자동 배정 등)
export function randomPaletteKey(): PaletteKey {
  return PALETTE_KEYS[Math.floor(Math.random() * PALETTE_KEYS.length)];
}
