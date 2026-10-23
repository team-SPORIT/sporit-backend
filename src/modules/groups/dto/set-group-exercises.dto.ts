import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

// 앞뒤 공백 제거 + 연속 공백을 1개로 정리 (문자열이 아니면 그대로 두어 검증이 400 처리)
const normalizeName = (value: unknown) =>
  typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;

// 그룹 허용 종목 설정용 DTO
export class SetGroupExercisesDto {
  @ApiProperty({
    description:
      'true면 모든 종목 허용(기존 허용 목록은 그대로 보관), false면 names에 있는 종목만 허용',
  })
  @IsBoolean()
  allowAll: boolean;

  @ApiPropertyOptional({
    description:
      '허용할 종목 이름 목록 (allowAll=false일 때 1개 이상 필수). 공백 정리 후 1~30자, 정리 후 중복은 제거된다. 이 그룹의 그룹 전용 종목을 이름으로 찾고 없으면 새로 만든다',
    type: String,
    isArray: true,
    maxItems: 50,
    example: ['러닝', '플랭크'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Transform(({ value }: { value: unknown }) =>
    Array.isArray(value) ? value.map(normalizeName) : value,
  )
  @IsString({ each: true })
  @Length(1, 30, { each: true })
  names?: string[];
}
