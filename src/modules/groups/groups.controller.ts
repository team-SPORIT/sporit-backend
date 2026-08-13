import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { JoinGroupDto } from './dto/join-group.dto';
import { GroupFeedResponseDto } from './dto/group-feed-response.dto';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('groups')
@ApiBearerAuth()
@Controller('groups')
@UseGuards(SupabaseAuthGuard)
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  // 그룹 생성
  @Post()
  @ApiOperation({ summary: '그룹 생성' })
  create(
    @CurrentUser() user: { id: string; email: string },
    @Body() createGroupDto: CreateGroupDto,
  ) {
    return this.groupsService.create(user.id, createGroupDto);
  }

  // 초대 코드로 그룹 참여
  @Post('join')
  @ApiOperation({ summary: '초대 코드로 그룹 참여' })
  join(
    @CurrentUser() user: { id: string; email: string },
    @Body() joinGroupDto: JoinGroupDto,
  ) {
    return this.groupsService.join(user.id, joinGroupDto);
  }

  // 내 그룹 목록 조회
  @Get()
  @ApiOperation({ summary: '내 그룹 목록 조회' })
  findMyGroups(@CurrentUser() user: { id: string; email: string }) {
    return this.groupsService.findMyGroups(user.id);
  }

  // 그룹 상세 조회 (멤버만 가능)
  @Get(':id')
  @ApiOperation({ summary: '그룹 상세 조회' })
  findOne(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
  ) {
    return this.groupsService.findOne(user.id, this.toBigIntId(id));
  }

  // 그룹 피드 조회 (멤버만, 오늘 공유 전이면 잠금)
  @Get(':id/feed')
  @ApiOperation({ summary: '그룹 피드 조회' })
  @ApiQuery({
    name: 'date',
    required: false,
    example: '2026-08-13',
    description: '조회할 날짜(KST, YYYY-MM-DD). 생략 시 오늘',
  })
  getFeed(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
    @Query('date') date?: string,
  ): Promise<GroupFeedResponseDto> {
    return this.groupsService.getFeed(user.id, this.toBigIntId(id), date);
  }

  // 그룹 탈퇴
  @Delete(':id/members/me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '그룹 탈퇴' })
  leave(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
  ) {
    return this.groupsService.leave(user.id, this.toBigIntId(id));
  }

  // 라우트 파라미터(string)를 BigInt로 변환, 숫자가 아니면 404로 처리
  private toBigIntId(id: string): bigint {
    try {
      return BigInt(id);
    } catch {
      throw new NotFoundException('그룹을 찾을 수 없습니다.');
    }
  }
}
