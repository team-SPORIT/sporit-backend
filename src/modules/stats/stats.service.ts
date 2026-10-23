import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  addDays,
  formatKstDate,
  getKstToday,
  getKstWeekStart,
  parseKstDate,
} from '../../common/utils/kst-date.util';
import {
  WeeklyDayStatsDto,
  WeeklyExerciseStatsDto,
  WeeklyStatsResponseDto,
} from './dto/weekly-stats-response.dto';

const DAYS_IN_WEEK = 7;

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

    const rows = await this.aggregateDailyByExercise(
      userId,
      weekStart,
      weekEnd,
    );

    const days = this.buildDays(weekStart, rows);

    return {
      weekStart: formatKstDate(weekStart),
      weekEnd: formatKstDate(weekEnd),
      totalSeconds: days.reduce((sum, day) => sum + day.totalSeconds, 0),
      totalCount: days.reduce((sum, day) => sum + day.count, 0),
      days,
      byExercise: this.buildByExercise(rows),
    };
  }

  // [start, end] 범위의 내 기록을 한 번의 쿼리로 날짜/종목별 합산 (duration_sec가 null이면 0으로 취급, count에는 포함)
  private async aggregateDailyByExercise(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<DailyExerciseRow[]> {
    const groups = await this.prisma.records.groupBy({
      by: ['record_date', 'exercise_type'],
      where: { user_id: userId, record_date: { gte: start, lte: end } },
      _sum: { duration_sec: true },
      _count: { _all: true },
    });

    return groups.map((group) => ({
      date: formatKstDate(group.record_date),
      exerciseType: group.exercise_type,
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

  // 종목별 합산, 운동 시간 내림차순
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
