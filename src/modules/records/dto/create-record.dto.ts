import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

// 운동 기록 생성용 DTO (multipart/form-data의 텍스트 필드)
export class CreateRecordDto {
  @ApiProperty({ description: '운동 종류', maxLength: 30 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  exerciseType: string;

  @ApiPropertyOptional({ description: '운동 시간(분)', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationMin?: number;

  @ApiPropertyOptional({ description: '소모 칼로리', minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  calories?: number;

  @ApiPropertyOptional({ description: '코멘트', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  comment?: string;
}
