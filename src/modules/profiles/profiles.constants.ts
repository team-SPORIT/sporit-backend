// 프로필 이미지가 저장되는 Supabase Storage 버킷명
export const PROFILE_IMAGES_BUCKET = 'profile-images';

// 프로필 이미지로 허용하는 MIME 타입 -> 저장 시 사용할 확장자
export const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
