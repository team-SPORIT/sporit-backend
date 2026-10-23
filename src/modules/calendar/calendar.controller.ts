import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CalendarService } from './calendar.service';

@ApiTags('calendar')
@ApiBearerAuth()
@Controller('calendar')
@UseGuards(SupabaseAuthGuard)
export class CalendarController {
  constructor(private readonly calendarService: CalendarService) {}

  // 내 월별 캘린더
  @Get()
  @ApiOperation({ summary: '내 월별 캘린더 조회' })
  getCalendar(
    @CurrentUser() user: { id: string; email: string },
    @Query('month') month?: string,
  ) {
    return this.calendarService.getCalendar(user.id, month);
  }
}
