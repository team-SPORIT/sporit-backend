import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// 그룹 생성용 DTO
export class CreateGroupDto {
  @ApiProperty({ description: '그룹 이름', maxLength: 50 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;

  @ApiPropertyOptional({
    description: '최대 인원 (기본 10)',
    minimum: 2,
    maximum: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(50)
  maxMembers?: number;
}
