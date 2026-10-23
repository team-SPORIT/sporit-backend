import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  formatKstDate,
  formatKstMonth,
  getKstMonthRange,
  getKstToday,
  parseKstMonth,
  toKstDate,
} from '../../common/utils/kst-date.util';
import {
  CalendarDayDto,
  CalendarResponseDto,
} from './dto/calendar-response.dto';

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  // 월별 캘린더. month(YYYY-MM)가 없으면 KST 기준 이번 달, 형식이 틀리거나 월이 01~12가 아니면 400
  // startMonth(가입한 달)와 함께, 해당 월 1일~말일(record_date 기준)에 내가 기록한 종목을 날짜별로 묶어서 내려준다 (기록이 있는 날만, 날짜 오름차순)
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
    const month = formatKstMonth(from);

    // 가입한 달(KST): profiles.created_at 기준
    const profile = await this.prisma.profiles.findUnique({
      where: { id: userId },
      select: { created_at: true },
    });
    if (!profile) {
      throw new NotFoundException('프로필을 찾을 수 없습니다.');
    }
    const startMonth = formatKstMonth(toKstDate(profile.created_at));

    // 가입 이전 달이나 아직 오지 않은 미래 달은 에러 없이 빈 days로 응답한다 (기록이 있을 수 없으므로 조회도 생략)
    const currentMonth = formatKstMonth(getKstToday());
    if (month < startMonth || month > currentMonth) {
      return { month, startMonth, days: [] };
    }

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

    await this.attachCategories(userId, [...days.values()]);

    return {
      month,
      startMonth,
      days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  // 등장한 종목 이름들의 카테고리를 exercise_category_map(+exercise_categories)에서 한 번에 조회해 붙인다.
  // 매핑이 없는 종목(미분류)은 categoryId/categoryName/color가 null로 남는다. color는 DB의 팔레트 키 그대로
  private async attachCategories(userId: string, days: CalendarDayDto[]) {
    const names = [
      ...new Set(
        days.flatMap((day) => day.exercises.map((e) => e.exerciseType)),
      ),
    ];
    if (names.length === 0) return;

    const mappings = await this.prisma.exercise_category_map.findMany({
      where: { user_id: userId, exercise_name: { in: names } },
      select: {
        exercise_name: true,
        exercise_categories: {
          select: { id: true, name: true, color: true },
        },
      },
    });
    const categoryByName = new Map(
      mappings.map((mapping) => [
        mapping.exercise_name,
        mapping.exercise_categories,
      ]),
    );

    for (const day of days) {
      for (const exercise of day.exercises) {
        const category = categoryByName.get(exercise.exerciseType);
        if (!category) continue;
        exercise.categoryId = category.id;
        exercise.categoryName = category.name;
        exercise.color = category.color;
      }
    }
  }
}
