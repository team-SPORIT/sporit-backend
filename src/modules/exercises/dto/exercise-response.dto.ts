import { ApiProperty } from '@nestjs/swagger';

// 종목 응답 (DB 컬럼 키 그대로 snake_case + isDefault. id는 BigInt라 전역 toJSON에 의해 문자열로 직렬화됨)
export class ExerciseResponseDto {
  @ApiProperty({ description: '종목 ID', type: String })
  id: bigint;

  @ApiProperty({ description: '종목 이름' })
  name: string;

  @ApiProperty({
    description: '종목 소유자 유저 ID (기본 종목이면 null)',
    nullable: true,
    type: String,
  })
  owner_id: string | null;

  @ApiProperty({ description: '생성 시각' })
  created_at: Date;

  @ApiProperty({ description: '기본 종목 여부 (owner_id가 null이면 true)' })
  isDefault: boolean;
}
