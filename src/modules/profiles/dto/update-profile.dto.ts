import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

// 프로필 부분 수정용 DTO - 모든 필드가 optional이라 보낸 필드만 갱신됨
export class UpdateProfileDto {
  @ApiPropertyOptional({ description: '닉네임', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  nickname?: string;

  @ApiPropertyOptional({ description: '프로필 이미지 URL', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  profile_image?: string;
}
