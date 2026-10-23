import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  formatKstMonth,
  getKstToday,
  parseKstMonth,
} from '../../common/utils/kst-date.util';

@Injectable()
export class CalendarService {
  constructor(private readonly prisma: PrismaService) {}

  // 월별 캘린더. month(YYYY-MM)가 없으면 KST 기준 이번 달, 형식이 틀리거나 월이 01~12가 아니면 400
  getCalendar(_userId: string, monthStr?: string) {
    const month = monthStr ? parseKstMonth(monthStr) : null;
    if (monthStr && !month) {
      throw new BadRequestException(
        'month는 YYYY-MM 형식(월 01~12)이어야 합니다.',
      );
    }

    return {
      month: monthStr ?? formatKstMonth(getKstToday()),
      days: [],
    };
  }
}
