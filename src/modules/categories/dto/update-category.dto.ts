import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PALETTE_KEYS } from '../../../common/constants/palette.constants';
import { CATEGORY_NAME_MAX_LENGTH } from '../categories.constants';

// 카테고리 부분 수정용 DTO (보낸 필드만 수정, 둘 다 없으면 400)
export class UpdateCategoryDto {
  @ApiPropertyOptional({
    description: '카테고리 이름 (trim 후 1~20자)',
    minLength: 1,
    maxLength: CATEGORY_NAME_MAX_LENGTH,
    example: '근력',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, CATEGORY_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    description: '색상 팔레트 키 (GET /categories/colors 참고)',
    enum: PALETTE_KEYS,
    example: 'red',
  })
  @IsOptional()
  @IsIn(PALETTE_KEYS)
  color?: string;
}
