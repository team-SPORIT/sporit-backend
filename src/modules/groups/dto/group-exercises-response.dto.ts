import { ApiProperty } from '@nestjs/swagger';

// 종목 요약 (id는 BigInt라 전역 toJSON에 의해 문자열로 직렬화됨)
export class ExerciseSummaryDto {
  @ApiProperty({ description: '종목 ID', type: String })
  id: bigint;

  @ApiProperty({ description: '종목 이름' })
  name: string;

  @ApiProperty({ description: '기본 종목 여부 (owner_id가 null이면 true)' })
  isDefault: boolean;
}

// 그룹 허용 종목 응답
export class GroupExercisesResponseDto {
  @ApiProperty({
    description: '허용 종목이 설정되어 있는지 (false면 제한 없음)',
  })
  restricted: boolean;

  @ApiProperty({
    description: '허용된 종목 목록 (id순). restricted가 false면 빈 배열',
    type: ExerciseSummaryDto,
    isArray: true,
  })
  exercises: ExerciseSummaryDto[];
}
