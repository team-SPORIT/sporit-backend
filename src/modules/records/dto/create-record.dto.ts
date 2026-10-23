import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// 운동 기록 생성용 DTO (multipart/form-data의 텍스트 필드)
export class CreateRecordDto {
  @ApiProperty({
    description: '종목 ID (내 개인 종목 또는 내가 속한 그룹의 허용 종목)',
    type: String,
  })
  @IsNotEmpty()
  @IsNumberString({ no_symbols: true })
  exerciseId: string;

  @ApiPropertyOptional({
    description: '운동 시간(초)',
    minimum: 0,
    maximum: 86400,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(86400)
  durationSec?: number;

  @ApiPropertyOptional({ description: '코멘트', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  comment?: string;
}
