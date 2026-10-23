import { ApiProperty } from '@nestjs/swagger';

// 내 개인 종목 응답 (DB 컬럼 키 그대로 snake_case. id는 BigInt라 전역 toJSON에 의해 문자열로 직렬화됨)
export class ExerciseResponseDto {
  @ApiProperty({ description: '종목 ID', type: String })
  id: bigint;

  @ApiProperty({ description: '종목 이름' })
  name: string;

  @ApiProperty({
    description: '종목 소유자 유저 ID (개인 종목이라 항상 내 ID)',
  })
  owner_id: string;

  @ApiProperty({ description: '생성 시각' })
  created_at: Date;
}
