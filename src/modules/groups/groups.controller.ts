import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { JoinGroupDto } from './dto/join-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { GroupExercisesResponseDto } from './dto/group-exercises-response.dto';
import { SetGroupExercisesDto } from './dto/set-group-exercises.dto';
import { GroupFeedResponseDto } from './dto/group-feed-response.dto';
import {
  GroupDetailResponseDto,
  GroupListItemDto,
  GroupResponseDto,
} from './dto/group-response.dto';
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
  @ApiOperation({
    summary: '그룹 생성',
    description:
      'color(팔레트 키)를 보내지 않으면 팔레트에서 무작위로 배정된다. 응답에는 color와 colorHex가 포함된다.',
  })
  @ApiCreatedResponse({ type: GroupResponseDto })
  @ApiBadRequestResponse({ description: '팔레트에 없는 color 등 형식 오류' })
  create(
    @CurrentUser() user: { id: string; email: string },
    @Body() createGroupDto: CreateGroupDto,
  ) {
    return this.groupsService.create(user.id, createGroupDto);
  }

  // 초대 코드로 그룹 참여
  @Post('join')
  @ApiCreatedResponse({ type: GroupResponseDto })
  @ApiOperation({
    summary: '초대 코드로 그룹 참여',
    description: '초대 코드는 대소문자 구분 없이 입력할 수 있다.',
  })
  join(
    @CurrentUser() user: { id: string; email: string },
    @Body() joinGroupDto: JoinGroupDto,
  ) {
    return this.groupsService.join(user.id, joinGroupDto);
  }

  // 내 그룹 목록 조회
  @Get()
  @ApiOperation({
    summary: '내 그룹 목록 조회',
    description:
      '최근 공유순(last_shared_at 내림차순)으로 정렬. 공유가 없는 그룹은 맨 뒤, 같으면 참여 순',
  })
  @ApiOkResponse({ type: GroupListItemDto, isArray: true })
  findMyGroups(@CurrentUser() user: { id: string; email: string }) {
    return this.groupsService.findMyGroups(user.id);
  }

  // 그룹 상세 조회 (멤버만 가능)
  @Get(':id')
  @ApiOperation({ summary: '그룹 상세 조회' })
  @ApiOkResponse({ type: GroupDetailResponseDto })
  findOne(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
  ) {
    return this.groupsService.findOne(user.id, this.toBigIntId(id));
  }

  // 그룹 수정 (그룹장만, 지금은 색상만)
  @Patch(':id')
  @ApiOperation({
    summary: '그룹 수정 (그룹장만, 색상)',
    description:
      '그룹장만 가능. 지금은 color(팔레트 키)만 수정할 수 있고 보낸 필드만 반영한다. 아무 필드도 없으면 400.',
  })
  @ApiParam({ name: 'id', description: '그룹 ID' })
  @ApiOkResponse({ type: GroupResponseDto })
  @ApiBadRequestResponse({
    description: '팔레트에 없는 color이거나 수정할 필드가 없음',
  })
  @ApiForbiddenResponse({ description: '그룹장이 아님' })
  @ApiNotFoundResponse({ description: '그룹을 찾을 수 없음' })
  update(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
    @Body() updateGroupDto: UpdateGroupDto,
  ) {
    return this.groupsService.update(
      user.id,
      this.toBigIntId(id),
      updateGroupDto,
    );
  }

  // 그룹 허용 종목 조회 (멤버만 가능)
  @Get(':id/exercises')
  @ApiOperation({
    summary: '그룹 허용 종목 조회',
    description:
      'allowAll=true면 모든 종목 허용이고, false면 exercises의 이름과 같은 종목만 공유할 수 있다. exercises는 저장된 허용 목록(그룹 전용 종목)이다.',
  })
  @ApiOkResponse({ type: GroupExercisesResponseDto })
  @ApiForbiddenResponse({ description: '그룹 멤버가 아님' })
  getExercises(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
  ): Promise<GroupExercisesResponseDto> {
    return this.groupsService.getExercises(user.id, this.toBigIntId(id));
  }

  // 그룹 허용 종목 설정 (그룹장만)
  @Put(':id/exercises')
  @ApiOperation({
    summary: '그룹 허용 종목 설정 (전체 교체)',
    description:
      '그룹장만 가능. allowAll=true면 모든 종목 허용(기존 목록은 보관), false면 names(1개 이상)로 그룹 전용 종목을 이름으로 찾거나 만들어 허용 목록을 전체 교체한다. 이미 공유된 기록에는 영향이 없다.',
  })
  @ApiOkResponse({ type: GroupExercisesResponseDto })
  @ApiBadRequestResponse({
    description:
      'allowAll=false인데 names가 없음, 이름 길이(1~30자)/배열 형식/개수(최대 50) 오류',
  })
  @ApiForbiddenResponse({ description: '그룹장이 아님' })
  @ApiNotFoundResponse({ description: '그룹을 찾을 수 없음' })
  setExercises(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
    @Body() setGroupExercisesDto: SetGroupExercisesDto,
  ): Promise<GroupExercisesResponseDto> {
    return this.groupsService.setExercises(
      user.id,
      this.toBigIntId(id),
      setGroupExercisesDto,
    );
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
