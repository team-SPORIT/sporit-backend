// 하루 단위 집계
export class WeeklyDayStatsDto {
  date: string;
  totalSeconds: number;
  count: number;
}

// 종목별 집계
export class WeeklyExerciseStatsDto {
  exerciseType: string;
  totalSeconds: number;
  count: number;
}

// 지난주 요약
export class PreviousWeekStatsDto {
  weekStart: string;
  totalSeconds: number;
  comparableSeconds: number;
}

// 주간 운동 통계 응답
export class WeeklyStatsResponseDto {
  weekStart: string;
  weekEnd: string;
  totalSeconds: number;
  totalCount: number;
  days: WeeklyDayStatsDto[];
  byExercise: WeeklyExerciseStatsDto[];
  previous: PreviousWeekStatsDto;
  diffSeconds: number;
}
