import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsString, Length } from 'class-validator';
import {
  EXERCISE_NAME_MAX_LENGTH,
  MAX_EXERCISE_NAMES_PER_REQUEST,
} from '../categories.constants';
import { normalizeExerciseNames } from './exercise-names.transform';

// 카테고리의 종목 목록 교체용 DTO (빈 배열이면 종목을 모두 비움)
export class SetCategoryExercisesDto {
  @ApiProperty({
    description:
      '카테고리에 넣을 종목 이름 목록 (전체 교체). 공백 정리 후 1~30자, 중복은 제거되며 한 번에 최대 100개. 이미 다른 내 카테고리에 있던 이름은 이 카테고리로 이동하고, 목록에서 빠진 이름은 매핑이 삭제된다. 종목 이름의 존재 여부는 검증하지 않는다',
    type: String,
    isArray: true,
    maxItems: MAX_EXERCISE_NAMES_PER_REQUEST,
    example: ['러닝', '사이클'],
  })
  @IsArray()
  @ArrayMaxSize(MAX_EXERCISE_NAMES_PER_REQUEST)
  @Transform(normalizeExerciseNames)
  @IsString({ each: true })
  @Length(1, EXERCISE_NAME_MAX_LENGTH, { each: true })
  exerciseNames: string[];
}
