import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateShareDto } from './dto/create-share.dto';
import { SharesService } from './shares.service';

@ApiTags('shares')
@ApiBearerAuth()
@Controller('shares')
@UseGuards(SupabaseAuthGuard)
export class SharesController {
  constructor(private readonly sharesService: SharesService) {}

  // 기록을 그룹에 공유
  @Post()
  @ApiOperation({
    summary: '기록을 그룹에 공유',
    description:
      '한 번에 한 그룹에 공유한다. 그룹이 허용 종목을 제한 중(allowAll=false)이면 기록 종목의 이름이 그 그룹 허용 종목 이름 중 하나와 같아야 한다.',
  })
  @ApiNotFoundResponse({ description: '기록을 찾을 수 없음' })
  @ApiForbiddenResponse({
    description:
      '본인 기록이 아니거나, 그룹 멤버가 아니거나, 이 그룹에서 허용되지 않은 종목',
  })
  @ApiConflictResponse({ description: '이미 이 그룹에 공유한 기록' })
  create(
    @CurrentUser() user: { id: string; email: string },
    @Body() createShareDto: CreateShareDto,
  ) {
    return this.sharesService.create(user.id, createShareDto);
  }

  // 공유 취소
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '기록 공유 취소' })
  remove(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
  ) {
    return this.sharesService.remove(user.id, this.toBigIntId(id));
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
