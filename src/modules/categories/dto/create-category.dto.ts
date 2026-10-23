import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { PALETTE_KEYS } from '../../../common/constants/palette.constants';
import {
  CATEGORY_NAME_MAX_LENGTH,
  EXERCISE_NAME_MAX_LENGTH,
  MAX_EXERCISE_NAMES_PER_REQUEST,
} from '../categories.constants';
import { normalizeExerciseNames } from './exercise-names.transform';

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
    enum: PALETTE_KEYS,
    example: 'blue',
  })
  @IsIn(PALETTE_KEYS)
  color: string;

  @ApiPropertyOptional({
    description:
      '카테고리에 바로 넣을 종목 이름 목록. 공백 정리 후 1~30자, 중복 제거, 최대 100개. 이미 다른 내 카테고리에 있던 이름은 이 카테고리로 이동한다',
    type: String,
    isArray: true,
    maxItems: MAX_EXERCISE_NAMES_PER_REQUEST,
    example: ['러닝'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_EXERCISE_NAMES_PER_REQUEST)
  @Transform(normalizeExerciseNames)
  @IsString({ each: true })
  @Length(1, EXERCISE_NAME_MAX_LENGTH, { each: true })
  exerciseNames?: string[];
}
