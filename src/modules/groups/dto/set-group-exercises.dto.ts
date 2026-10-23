import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsNumberString } from 'class-validator';

// 그룹 허용 종목 전체 교체용 DTO (빈 배열이면 제한 없음)
export class SetGroupExercisesDto {
  @ApiProperty({
    description:
      '허용할 기본 종목 ID 목록 (전체 교체, 중복은 제거됨, 빈 배열이면 제한 없음)',
    type: String,
    isArray: true,
    maxItems: 50,
    example: ['1', '2'],
  })
  @IsArray()
  @ArrayMaxSize(50)
  @IsNumberString({ no_symbols: true }, { each: true })
  exerciseIds: string[];
}
