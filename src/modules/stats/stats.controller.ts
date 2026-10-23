import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StatsService } from './stats.service';

@ApiTags('stats')
@ApiBearerAuth()
@Controller('stats')
@UseGuards(SupabaseAuthGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  // 내 주간 운동 통계
  @Get('weekly')
  @ApiOperation({ summary: '내 주간 운동 통계 조회' })
  getWeekly(
    @CurrentUser() user: { id: string; email: string },
    @Query('weekStart') weekStart?: string,
  ) {
    return this.statsService.getWeekly(user.id, weekStart);
  }
}
