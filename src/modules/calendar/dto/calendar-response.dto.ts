import { ApiProperty } from '@nestjs/swagger';
import { CATEGORY_COLORS } from '../../categories/categories.constants';

// 캘린더 하루에 기록된 종목 (같은 이름은 하루에 한 번만. categoryId는 BigInt라 전역 toJSON에 의해 문자열로 직렬화됨)
export class CalendarExerciseDto {
  @ApiProperty({ description: '종목 이름', example: '러닝' })
  exerciseType: string;

  @ApiProperty({
    description: '카테고리 ID (카테고리에 속하지 않은 미분류 종목이면 null)',
    type: String,
    nullable: true,
    example: '3',
  })
  categoryId: bigint | null;

  @ApiProperty({
    description: '카테고리 이름 (미분류면 null)',
    type: String,
    nullable: true,
    example: '유산소',
  })
  categoryName: string | null;

  @ApiProperty({
    description: '카테고리 색상 팔레트 키 (미분류면 null)',
    type: String,
    enum: CATEGORY_COLORS,
    nullable: true,
    example: 'blue',
  })
  color: string | null;
}

// 기록이 있는 하루
export class CalendarDayDto {
  @ApiProperty({ description: '날짜 (KST, YYYY-MM-DD)', example: '2026-10-05' })
  date: string;

  @ApiProperty({
    description:
      '그날 기록한 종목 목록 (이름 기준 중복 제거, 먼저 기록한 종목 순)',
    type: CalendarExerciseDto,
    isArray: true,
  })
  exercises: CalendarExerciseDto[];
}

// 월별 캘린더 응답
export class CalendarResponseDto {
  @ApiProperty({ description: '조회한 달 (KST, YYYY-MM)', example: '2026-10' })
  month: string;

  @ApiProperty({
    description:
      '가입한 달 (KST, YYYY-MM, profiles.created_at 기준). 이보다 이전 달은 빈 days로 응답한다',
    example: '2026-08',
  })
  startMonth: string;

  @ApiProperty({
    description:
      '기록이 있는 날만, 날짜 오름차순. 기록이 없거나 가입 이전/미래 달이면 빈 배열',
    type: CalendarDayDto,
    isArray: true,
  })
  days: CalendarDayDto[];
}
