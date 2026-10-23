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
import { WeeklyStatsResponseDto } from './dto/weekly-stats-response.dto';
import { StatsService } from './stats.service';

@ApiTags('stats')
@ApiBearerAuth()
@Controller('stats')
@UseGuards(SupabaseAuthGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  // 내 주간 운동 통계
  @Get('weekly')
  @ApiOperation({
    summary: '내 주간 운동 통계 조회',
    description:
      '월요일~일요일 기준 주간 통계. 이번 주 조회 시 지난주는 오늘과 같은 요일까지만 비교한다.',
  })
  @ApiQuery({
    name: 'weekStart',
    required: false,
    description:
      '조회할 주에 속한 날짜 (YYYY-MM-DD, KST). 월요일이 아니면 그 주의 월요일로 보정. 생략하면 이번 주',
    example: '2026-10-19',
  })
  @ApiOkResponse({ type: WeeklyStatsResponseDto })
  @ApiBadRequestResponse({ description: 'weekStart 형식이 잘못됨' })
  @ApiUnauthorizedResponse({ description: '토큰이 없거나 유효하지 않음' })
  getWeekly(
    @CurrentUser() user: { id: string; email: string },
    @Query('weekStart') weekStart?: string,
  ) {
    return this.statsService.getWeekly(user.id, weekStart);
  }
}
