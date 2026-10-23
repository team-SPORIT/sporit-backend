import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReactionsService } from './reactions.service';

@ApiTags('reactions')
@ApiBearerAuth()
@Controller('shares/:shareId/reaction')
@UseGuards(SupabaseAuthGuard)
export class ReactionsController {
  constructor(private readonly reactionsService: ReactionsService) {}

  // 좋아요 (멱등)
  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '공유된 기록에 좋아요' })
  @ApiParam({ name: 'shareId', description: '공유 ID' })
  @ApiNoContentResponse({ description: '좋아요 완료(이미 눌렀어도 성공)' })
  @ApiForbiddenResponse({
    description: '그룹 멤버가 아니거나 오늘 공유 전(잠금)',
  })
  @ApiNotFoundResponse({ description: '공유를 찾을 수 없음' })
  like(
    @CurrentUser() user: { id: string; email: string },
    @Param('shareId') shareId: string,
  ) {
    return this.reactionsService.like(user.id, this.toBigIntId(shareId));
  }

  // 좋아요 취소 (멱등)
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '공유된 기록 좋아요 취소' })
  @ApiParam({ name: 'shareId', description: '공유 ID' })
  @ApiNoContentResponse({
    description: '좋아요 취소 완료(누르지 않았어도 성공)',
  })
  @ApiForbiddenResponse({
    description: '그룹 멤버가 아니거나 오늘 공유 전(잠금)',
  })
  @ApiNotFoundResponse({ description: '공유를 찾을 수 없음' })
  unlike(
    @CurrentUser() user: { id: string; email: string },
    @Param('shareId') shareId: string,
  ) {
    return this.reactionsService.unlike(user.id, this.toBigIntId(shareId));
  }

  // 라우트 파라미터(string)를 BigInt로 변환, 숫자가 아니면 404로 처리
  private toBigIntId(id: string): bigint {
    try {
      return BigInt(id);
    } catch {
      throw new NotFoundException('공유를 찾을 수 없습니다.');
    }
  }
}
