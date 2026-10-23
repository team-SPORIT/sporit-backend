import { ApiProperty } from '@nestjs/swagger';

// 종목 요약 (id는 BigInt라 전역 toJSON에 의해 문자열로 직렬화됨)
export class ExerciseSummaryDto {
  @ApiProperty({ description: '종목 ID', type: String })
  id: bigint;

  @ApiProperty({ description: '종목 이름' })
  name: string;
}

// 그룹 허용 종목 응답
export class GroupExercisesResponseDto {
  @ApiProperty({
    description:
      'true면 모든 종목 허용(exercises는 이전에 설정해 둔 허용 목록이며 적용되지 않음), false면 exercises의 이름과 같은 종목만 공유 가능',
  })
  allowAll: boolean;

  @ApiProperty({
    description: '저장된 허용 종목 목록 (그룹 전용 종목, id순)',
    type: ExerciseSummaryDto,
    isArray: true,
  })
  exercises: ExerciseSummaryDto[];
}
