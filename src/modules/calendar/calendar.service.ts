import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  formatKstDate,
  formatKstMonth,
  getKstMonthRange,
  getKstToday,
  parseKstMonth,
} from '../../common/utils/kst-date.util';
import {
  CalendarDayDto,
  CalendarResponseDto,
} from './dto/calendar-response.dto';

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  // 월별 캘린더. month(YYYY-MM)가 없으면 KST 기준 이번 달, 형식이 틀리거나 월이 01~12가 아니면 400
  // 해당 월 1일~말일(record_date 기준)에 내가 기록한 종목을 날짜별로 묶어서 내려준다 (기록이 있는 날만, 날짜 오름차순)
  async getCalendar(
    userId: string,
    monthStr?: string,
  ): Promise<CalendarResponseDto> {
    const parsed = monthStr
      ? parseKstMonth(monthStr)
      : parseKstMonth(formatKstMonth(getKstToday()));
    if (!parsed) {
      throw new BadRequestException(
        'month는 YYYY-MM 형식(월 01~12)이어야 합니다.',
      );
    }
    const { from, to } = getKstMonthRange(parsed.year, parsed.month);

    // 필요한 컬럼(날짜, 생성 시각, 종목 이름)만 한 번의 쿼리로 가져온다. 먼저 기록한 종목이 먼저 오도록 created_at 오름차순
    const records = await this.prisma.records.findMany({
      where: { user_id: userId, record_date: { gte: from, lte: to } },
      select: {
        record_date: true,
        created_at: true,
        exercises: { select: { name: true } },
      },
      orderBy: [{ record_date: 'asc' }, { created_at: 'asc' }],
    });

    // (날짜, 종목 이름) 기준으로 중복 제거. 같은 이름이면 exercise_id가 달라도 한 번만 나온다
    const days = new Map<string, CalendarDayDto>();
    for (const record of records) {
      const date = formatKstDate(record.record_date);
      const day = days.get(date) ?? { date, exercises: [] };
      const exerciseType = record.exercises.name;

      if (!day.exercises.some((e) => e.exerciseType === exerciseType)) {
        day.exercises.push({
          exerciseType,
          categoryId: null,
          categoryName: null,
          color: null,
        });
      }
      days.set(date, day);
    }

    return {
      month: formatKstMonth(from),
      days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
}
