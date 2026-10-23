// 캘린더 하루에 기록된 종목 (같은 이름은 하루에 한 번만)
export class CalendarExerciseDto {
  exerciseType: string;
  categoryId: bigint | null;
  categoryName: string | null;
  color: string | null;
}

// 기록이 있는 하루
export class CalendarDayDto {
  date: string;
  exercises: CalendarExerciseDto[];
}

// 월별 캘린더 응답
export class CalendarResponseDto {
  month: string;
  startMonth: string;
  days: CalendarDayDto[];
}
