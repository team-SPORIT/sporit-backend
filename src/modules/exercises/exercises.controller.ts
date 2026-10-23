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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ExercisesService } from './exercises.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { ExerciseResponseDto } from './dto/exercise-response.dto';
import { SelectableExercisesResponseDto } from './dto/selectable-exercises-response.dto';
import { GroupListItemDto } from '../groups/dto/group-response.dto';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('exercises')
@ApiBearerAuth()
@Controller('exercises')
@UseGuards(SupabaseAuthGuard)
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  // 기록 작성 화면용 선택 목록 (내 개인 종목 + 제한 있는 그룹의 허용 종목)
  @Get('selectable')
  @ApiOperation({
    summary: '기록 작성 화면용 선택 가능 종목 조회',
    description:
      'defaults: 기본 종목 전체. mine: 내 개인 종목. groups: 내가 속한 그룹 중 허용 종목이 설정된(제한 있는) 그룹과 그 허용 종목(제한 없는 그룹은 제외).',
  })
  @ApiOkResponse({ type: SelectableExercisesResponseDto })
  findSelectable(
    @CurrentUser() user: { id: string; email: string },
  ): Promise<SelectableExercisesResponseDto> {
    return this.exercisesService.findSelectable(user.id);
  }

  // 이 종목으로 기록을 공유할 수 있는 내 그룹 목록
  @Get(':id/groups')
  @ApiOperation({
    summary: '종목별 공유 가능한 내 그룹 목록 조회',
    description:
      '내가 속한 그룹 중 허용 종목이 없는 그룹(제한 없음) 또는 이 종목이 허용된 그룹. 정렬과 응답 형태는 GET /groups와 동일(최근 공유순).',
  })
  @ApiParam({ name: 'id', description: '종목 ID (기본 종목 또는 내 종목)' })
  @ApiOkResponse({ type: GroupListItemDto, isArray: true })
  @ApiForbiddenResponse({ description: '남의 개인 종목' })
  @ApiNotFoundResponse({ description: '종목을 찾을 수 없음' })
  findGroups(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
  ) {
    return this.exercisesService.findGroupsForExercise(
      user.id,
      this.toBigIntId(id),
    );
  }

  // 개인 종목 추가
  @Post()
  @ApiOperation({ summary: '개인 종목 추가' })
  @ApiCreatedResponse({ type: ExerciseResponseDto })
  @ApiConflictResponse({
    description: '같은 이름의 기본 종목이 있거나 내 종목에 이미 있음',
  })
  create(
    @CurrentUser() user: { id: string; email: string },
    @Body() createExerciseDto: CreateExerciseDto,
  ) {
    return this.exercisesService.create(user.id, createExerciseDto);
  }

  // 개인 종목 삭제 (내 종목만)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '개인 종목 삭제' })
  @ApiNoContentResponse({ description: '삭제 완료' })
  @ApiForbiddenResponse({ description: '기본 종목이거나 남의 종목' })
  @ApiNotFoundResponse({ description: '종목을 찾을 수 없음' })
  @ApiConflictResponse({ description: '기록이 있는 종목은 삭제할 수 없음' })
  remove(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
  ) {
    return this.exercisesService.remove(user.id, this.toBigIntId(id));
  }

  // 라우트 파라미터(string)를 BigInt로 변환, 숫자가 아니면 404로 처리
  private toBigIntId(id: string): bigint {
    try {
      return BigInt(id);
    } catch {
      throw new NotFoundException('종목을 찾을 수 없습니다.');
    }
  }
}
