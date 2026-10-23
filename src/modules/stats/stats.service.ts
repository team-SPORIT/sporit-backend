import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  addDays,
  formatKstDate,
  getKstToday,
  getKstWeekStart,
  parseKstDate,
  subtractDays,
} from '../../common/utils/kst-date.util';
import {
  WeeklyDayStatsDto,
  WeeklyExerciseStatsDto,
  WeeklyStatsResponseDto,
} from './dto/weekly-stats-response.dto';

const DAYS_IN_WEEK = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

// record_date + 종목 단위로 묶은 집계 행
interface DailyExerciseRow {
  date: string;
  exerciseType: string;
  totalSeconds: number;
  count: number;
}

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  // 주간 운동 통계 (월요일 시작~일요일 끝). weekStart가 없으면 이번 주, 월요일이 아니면 그 주의 월요일로 보정
  async getWeekly(
    userId: string,
    weekStartStr?: string,
  ): Promise<WeeklyStatsResponseDto> {
    const baseDate = weekStartStr ? parseKstDate(weekStartStr) : getKstToday();
    if (!baseDate) {
      throw new BadRequestException(
        'weekStart는 YYYY-MM-DD 형식이어야 합니다.',
      );
    }

    const weekStart = getKstWeekStart(baseDate);
    const weekEnd = addDays(weekStart, DAYS_IN_WEEK - 1);
    const previousWeekStart = subtractDays(weekStart, DAYS_IN_WEEK);

    // 이번 주 + 지난주(14일치)를 한 번의 쿼리로 가져와 서버에서 나눠 합산한다
    const rows = await this.aggregateDailyByExercise(
      userId,
      previousWeekStart,
      weekEnd,
    );
    const weekStartKey = formatKstDate(weekStart);
    const currentRows = rows.filter((row) => row.date >= weekStartKey);

    const days = this.buildDays(weekStart, currentRows);
    const previousDays = this.buildDays(previousWeekStart, rows);
    const totalSeconds = days.reduce((sum, day) => sum + day.totalSeconds, 0);
    const previousTotalSeconds = previousDays.reduce(
      (sum, day) => sum + day.totalSeconds,
      0,
    );
    const comparableSeconds = this.sumComparableSeconds(
      previousDays,
      weekStart,
    );

    return {
      weekStart: weekStartKey,
      weekEnd: formatKstDate(weekEnd),
      totalSeconds,
      totalCount: days.reduce((sum, day) => sum + day.count, 0),
      days,
      byExercise: this.buildByExercise(currentRows),
      previous: {
        weekStart: formatKstDate(previousWeekStart),
        totalSeconds: previousTotalSeconds,
        comparableSeconds,
      },
      diffSeconds: totalSeconds - comparableSeconds,
    };
  }

  // 지난주 중 비교 대상 구간의 합계
  // 이번 주를 조회 중이면 오늘과 같은 요일까지만, 이미 지난 주나 아직 오지 않은 주면 7일 전체
  private sumComparableSeconds(
    previousDays: WeeklyDayStatsDto[],
    weekStart: Date,
  ): number {
    const today = getKstToday();
    const dayIndexOfToday = Math.round(
      (today.getTime() - weekStart.getTime()) / DAY_MS,
    );
    const isCurrentWeek =
      dayIndexOfToday >= 0 && dayIndexOfToday < DAYS_IN_WEEK;
    const comparableDays = isCurrentWeek
      ? previousDays.slice(0, dayIndexOfToday + 1)
      : previousDays;

    return comparableDays.reduce((sum, day) => sum + day.totalSeconds, 0);
  }

  // [start, end] 범위의 내 기록을 한 번의 쿼리로 날짜/종목(exercise_id)별 합산한 뒤 이름 기준으로 합친다 (duration_sec가 null이면 0으로 취급, count에는 포함)
  // 종목 이름은 집계에 나온 exercise_id들을 exercises에서 한 번에 조회해 채운다
  private async aggregateDailyByExercise(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<DailyExerciseRow[]> {
    const groups = await this.prisma.records.groupBy({
      by: ['record_date', 'exercise_id'],
      where: { user_id: userId, record_date: { gte: start, lte: end } },
      _sum: { duration_sec: true },
      _count: { _all: true },
    });

    const exerciseIds = [...new Set(groups.map((group) => group.exercise_id))];
    const exercises = await this.prisma.exercises.findMany({
      where: { id: { in: exerciseIds } },
      select: { id: true, name: true },
    });
    const nameById = new Map(
      exercises.map((exercise) => [exercise.id, exercise.name]),
    );

    return groups.map((group) => ({
      date: formatKstDate(group.record_date),
      exerciseType: nameById.get(group.exercise_id) ?? '',
      totalSeconds: Number(group._sum.duration_sec ?? 0),
      count: Number(group._count._all),
    }));
  }

  // weekStart부터 7일을 항상 채워서 반환 (기록 없는 날은 0)
  private buildDays(
    weekStart: Date,
    rows: DailyExerciseRow[],
  ): WeeklyDayStatsDto[] {
    const days: WeeklyDayStatsDto[] = Array.from(
      { length: DAYS_IN_WEEK },
      (_, index) => ({
        date: formatKstDate(addDays(weekStart, index)),
        totalSeconds: 0,
        count: 0,
      }),
    );
    const dayByDate = new Map(days.map((day) => [day.date, day]));

    for (const row of rows) {
      const day = dayByDate.get(row.date);
      if (!day) continue;
      day.totalSeconds += row.totalSeconds;
      day.count += row.count;
    }

    return days;
  }

  // 종목 "이름"별 합산, 운동 시간 내림차순 (개인 종목과 그룹 전용 종목처럼 id가 달라도 이름이 같으면 합산)
  private buildByExercise(rows: DailyExerciseRow[]): WeeklyExerciseStatsDto[] {
    const byExercise = new Map<string, WeeklyExerciseStatsDto>();

    for (const row of rows) {
      const entry = byExercise.get(row.exerciseType) ?? {
        exerciseType: row.exerciseType,
        totalSeconds: 0,
        count: 0,
      };
      entry.totalSeconds += row.totalSeconds;
      entry.count += row.count;
      byExercise.set(row.exerciseType, entry);
    }

    return [...byExercise.values()].sort(
      (a, b) => b.totalSeconds - a.totalSeconds,
    );
  }
}
