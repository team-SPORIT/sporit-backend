import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PALETTE_KEYS } from '../../../common/constants/palette.constants';

// 그룹 부분 수정용 DTO (지금은 color만 받으며, 보낸 필드만 수정하고 아무 필드도 없으면 400)
export class UpdateGroupDto {
  @ApiPropertyOptional({
    description: '그룹 색상 팔레트 키 (GET /categories/colors 참고)',
    enum: PALETTE_KEYS,
    example: 'purple',
  })
  @IsOptional()
  @IsIn(PALETTE_KEYS)
  color?: string;
}
