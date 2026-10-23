import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PALETTE_KEYS } from '../../../common/constants/palette.constants';
import { normalizeNames } from './normalize-names';

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

  @ApiPropertyOptional({
    description:
      '모든 종목 허용 여부 (기본 true). false면 names에 있는 종목만 공유할 수 있다',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  allowAll?: boolean;

  @ApiPropertyOptional({
    description:
      '허용할 종목 이름 목록. allowAll=false일 때 1개 이상 필수이고, allowAll이 true(또는 생략)인데 names가 있으면 400. 공백 정리 후 1~30자, 중복은 제거되며 이 그룹의 그룹 전용 종목으로 만들어진다',
    type: String,
    isArray: true,
    maxItems: 50,
    example: ['러닝', '요가'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @Transform(normalizeNames)
  @IsString({ each: true })
  @Length(1, 30, { each: true })
  names?: string[];
}
