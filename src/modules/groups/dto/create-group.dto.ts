import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PALETTE_KEYS } from '../../../common/constants/palette.constants';

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

  @ApiPropertyOptional({
    description:
      '그룹 색상 팔레트 키 (GET /categories/colors 참고). 생략하면 팔레트에서 무작위로 배정된다',
    enum: PALETTE_KEYS,
    example: 'blue',
  })
  @IsOptional()
  @IsIn(PALETTE_KEYS)
  color?: string;
}
