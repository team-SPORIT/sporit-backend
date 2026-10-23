import { ApiProperty } from '@nestjs/swagger';
import { PALETTE_KEYS } from '../../../common/constants/palette.constants';

// 카테고리 응답 (키는 camelCase. id는 BigInt라 전역 toJSON에 의해 문자열로 직렬화됨)
export class CategoryResponseDto {
  @ApiProperty({ description: '카테고리 ID', type: String, example: '1' })
  id: bigint;

  @ApiProperty({ description: '카테고리 이름', example: '유산소' })
  name: string;

  @ApiProperty({
    description: '색상 팔레트 키',
    enum: PALETTE_KEYS,
    example: 'blue',
  })
  color: string;

  @ApiProperty({
    description:
      '색상 hex 값 (color 키에 대응). 이전 팔레트의 키가 남아 있으면 null',
    type: String,
    nullable: true,
    example: '#0079FF',
  })
  colorHex: string | null;

  @ApiProperty({
    description: '이 카테고리에 매핑된 종목 이름 목록 (이름순)',
    type: String,
    isArray: true,
    example: ['러닝', '사이클'],
  })
  exerciseNames: string[];
}

// 색상 팔레트 응답
export class PaletteColorDto {
  @ApiProperty({
    description: '팔레트 키 (color 값으로 사용)',
    example: 'blue',
  })
  key: string;

  @ApiProperty({ description: '색상 hex 값', example: '#0079FF' })
  hex: string;
}

export class CategoryColorsResponseDto {
  @ApiProperty({
    description: '사용할 수 있는 색상 팔레트 (12색)',
    type: PaletteColorDto,
    isArray: true,
  })
  colors: PaletteColorDto[];
}
