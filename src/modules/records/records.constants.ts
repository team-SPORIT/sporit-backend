// 운동 기록 이미지가 저장되는 Supabase Storage 버킷명
export const RECORD_IMAGES_BUCKET = 'record-images';

// 운동 기록 이미지로 허용하는 MIME 타입 -> 저장 시 사용할 확장자
export const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const RECORD_IMAGE_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// "최근 기록" 조회 기간(일). KST 기준 오늘을 포함해 최근 7일이며, 이보다 오래된 기록도 DB에는 그대로 둔다
export const RECENT_DAYS = 7;
