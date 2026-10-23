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
    description: '이 카테고리에 매핑된 종목 이름 목록 (이름순)',
    type: String,
    isArray: true,
    example: ['러닝', '사이클'],
  })
  exerciseNames: string[];
}

// 색상 팔레트 응답
export class CategoryColorsResponseDto {
  @ApiProperty({
    description: '사용할 수 있는 색상 팔레트 키 목록',
    type: String,
    isArray: true,
    example: PALETTE_KEYS,
  })
  colors: string[];
}
