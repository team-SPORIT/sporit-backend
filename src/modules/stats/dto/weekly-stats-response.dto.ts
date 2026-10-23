import { ApiProperty } from '@nestjs/swagger';

// 하루 단위 집계
export class WeeklyDayStatsDto {
  @ApiProperty({ description: '날짜 (KST, YYYY-MM-DD)', example: '2026-10-19' })
  date: string;

  @ApiProperty({ description: '해당 날짜의 운동 시간 합계(초)' })
  totalSeconds: number;

  @ApiProperty({ description: '해당 날짜의 기록 횟수' })
  count: number;
}

// 종목별 집계
export class WeeklyExerciseStatsDto {
  @ApiProperty({
    description: '종목 이름 (같은 이름은 종목 ID가 달라도 합산)',
  })
  exerciseType: string;

  @ApiProperty({ description: '해당 종목의 운동 시간 합계(초)' })
  totalSeconds: number;

  @ApiProperty({ description: '해당 종목의 기록 횟수' })
  count: number;
}

// 지난주 요약
export class PreviousWeekStatsDto {
  @ApiProperty({
    description: '지난주 시작일 (월요일, YYYY-MM-DD)',
    example: '2026-10-12',
  })
  weekStart: string;

  @ApiProperty({ description: '지난주 7일 전체 운동 시간 합계(초)' })
  totalSeconds: number;

  @ApiProperty({
    description:
      '이번 주 비교 기준 지난주 합계(초). 이번 주 조회 시 오늘과 같은 요일까지만 합산, 지난 주/미래 주 조회 시 totalSeconds와 같음',
  })
  comparableSeconds: number;
}

// 주간 운동 통계 응답
export class WeeklyStatsResponseDto {
  @ApiProperty({
    description: '주 시작일 (월요일, YYYY-MM-DD)',
    example: '2026-10-19',
  })
  weekStart: string;

  @ApiProperty({
    description: '주 종료일 (일요일, YYYY-MM-DD)',
    example: '2026-10-25',
  })
  weekEnd: string;

  @ApiProperty({ description: '해당 주 운동 시간 합계(초)' })
  totalSeconds: number;

  @ApiProperty({ description: '해당 주 기록 횟수' })
  totalCount: number;

  @ApiProperty({
    description: '월~일 7일 집계 (기록 없는 날은 0)',
    type: WeeklyDayStatsDto,
    isArray: true,
  })
  days: WeeklyDayStatsDto[];

  @ApiProperty({
    description: '종목 이름별 집계 (운동 시간 내림차순)',
    type: WeeklyExerciseStatsDto,
    isArray: true,
  })
  byExercise: WeeklyExerciseStatsDto[];

  @ApiProperty({ description: '지난주 요약', type: PreviousWeekStatsDto })
  previous: PreviousWeekStatsDto;

  @ApiProperty({
    description:
      'totalSeconds - previous.comparableSeconds (음수면 지난주보다 덜 한 것)',
  })
  diffSeconds: number;
}
