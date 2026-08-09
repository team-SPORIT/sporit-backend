import { IsOptional, IsString, MaxLength } from 'class-validator';

// 프로필 부분 수정용 DTO - 모든 필드가 optional이라 보낸 필드만 갱신됨
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  profile_image?: string;
}
