import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CalendarService } from './calendar.service';
import { CalendarResponseDto } from './dto/calendar-response.dto';

@ApiTags('calendar')
@ApiBearerAuth()
@Controller('calendar')
@UseGuards(SupabaseAuthGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  // 내 월별 캘린더
  @Get()
  @ApiOperation({
    summary: '내 월별 캘린더 조회',
    description:
      '해당 월(KST)의 1일~말일에 내가 기록한 종목을 날짜별로 내려준다. 같은 이름의 종목은 종목 ID가 달라도 하루에 한 번만 나오고, 카테고리가 있으면 categoryId/categoryName/color가 채워진다(미분류는 null). 가입 이전 달이나 미래 달은 빈 days와 startMonth를 돌려준다.',
  })
  @ApiQuery({
    name: 'month',
    required: false,
    description: '조회할 달 (YYYY-MM, 월 01~12). 생략하면 KST 기준 이번 달',
    example: '2026-10',
  })
  @ApiOkResponse({ type: CalendarResponseDto })
  @ApiBadRequestResponse({ description: 'month 형식 오류 (YYYY-MM, 월 01~12)' })
  @ApiUnauthorizedResponse({ description: '토큰이 없거나 유효하지 않음' })
  getCalendar(
    @CurrentUser() user: { id: string; email: string },
    @Query('month') month?: string,
  ): Promise<CalendarResponseDto> {
    return this.calendarService.getCalendar(user.id, month);
  }
}
