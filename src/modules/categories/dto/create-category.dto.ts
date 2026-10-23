import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsString, Length } from 'class-validator';
import {
  CATEGORY_COLORS,
  CATEGORY_NAME_MAX_LENGTH,
} from '../categories.constants';

// 카테고리 생성용 DTO
export class CreateCategoryDto {
  @ApiProperty({
    description: '카테고리 이름 (trim 후 1~20자)',
    minLength: 1,
    maxLength: CATEGORY_NAME_MAX_LENGTH,
    example: '유산소',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(1, CATEGORY_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({
    description: '색상 팔레트 키 (GET /categories/colors 참고)',
    enum: CATEGORY_COLORS,
    example: 'blue',
  })
  @IsIn(CATEGORY_COLORS)
  color: string;
}
