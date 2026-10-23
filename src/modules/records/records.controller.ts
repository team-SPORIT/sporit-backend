import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateRecordDto } from './dto/create-record.dto';
import { RecentRecordsResponseDto } from './dto/recent-records-response.dto';
import { RecordResponseDto } from './dto/record-response.dto';
import {
  type RecordImageFiles,
  RecordImagesPipe,
} from './pipes/record-images.pipe';
import { RecordsService } from './records.service';

@ApiTags('records')
@ApiBearerAuth()
@Controller('records')
@UseGuards(SupabaseAuthGuard)
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  // 운동 기록 작성 (시작/종료 이미지 필수, multipart/form-data)
  @Post()
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'startFile', maxCount: 1 },
      { name: 'endFile', maxCount: 1 },
    ]),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '운동 기록 작성' })
  @ApiCreatedResponse({ type: RecordResponseDto })
  @ApiNotFoundResponse({ description: '종목을 찾을 수 없음' })
  @ApiForbiddenResponse({ description: '사용할 수 없는 종목' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['startFile', 'endFile', 'exerciseId'],
      properties: {
        startFile: {
          type: 'string',
          format: 'binary',
          description: '운동 시작 사진',
        },
        endFile: {
          type: 'string',
          format: 'binary',
          description: '운동 종료 사진',
        },
        exerciseId: {
          type: 'string',
          description:
            '종목 ID (내 개인 종목 또는 내가 속한 그룹의 허용 종목, GET /exercises/selectable 참고)',
        },
        durationSec: {
          type: 'number',
          minimum: 0,
          maximum: 86400,
          description: '운동 시간(초)',
        },
        comment: { type: 'string', description: '코멘트' },
      },
    },
  })
  create(
    @CurrentUser() user: { id: string; email: string },
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    createRecordDto: CreateRecordDto,
    @UploadedFiles(RecordImagesPipe) files: RecordImageFiles,
  ) {
    return this.recordsService.create(user.id, createRecordDto, files);
  }

  // 내 월별 기록 조회 (캘린더용)
  @Get('me')
  @ApiOperation({ summary: '내 월별 운동 기록 조회' })
  @ApiOkResponse({ type: RecordResponseDto, isArray: true })
  @ApiQuery({ name: 'year', type: Number, example: 2026 })
  @ApiQuery({ name: 'month', type: Number, example: 8 })
  findMyRecordsByMonth(
    @CurrentUser() user: { id: string; email: string },
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    return this.recordsService.findMyRecordsByMonth(user.id, year, month);
  }

  // 내 최근 7일 기록 조회 (종목 이름별). 라우트 충돌을 피하려고 :id 라우트보다 먼저 선언한다
  @Get('me/recent')
  @ApiOperation({
    summary: '내 최근 7일 기록 조회 (종목별)',
    description:
      'KST 기준 오늘을 포함한 최근 7일(record_date)의 내 기록을 종목 이름별로 묶어서 내려준다. 같은 이름의 종목은 종목 ID가 달라도 한 종목으로 합산한다. 7일이 지난 기록도 삭제되지 않고 이 조회에서만 제외된다. 시작/종료 사진(startImageUrl, endImageUrl)이 모든 기록에 포함된다.',
  })
  @ApiQuery({
    name: 'exerciseType',
    required: false,
    description:
      '종목 이름 (trim 후 정확히 일치하는 종목의 기록만). 생략하면 전체 종목',
    example: '러닝',
  })
  @ApiOkResponse({ type: RecentRecordsResponseDto })
  findMyRecentRecords(
    @CurrentUser() user: { id: string; email: string },
    @Query('exerciseType') exerciseType?: string,
  ): Promise<RecentRecordsResponseDto> {
    return this.recordsService.findMyRecentRecords(user.id, exerciseType);
  }

  // 기록 상세 조회 (본인 기록만)
  @Get(':id')
  @ApiOperation({ summary: '운동 기록 상세 조회' })
  @ApiOkResponse({ type: RecordResponseDto })
  findOne(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
  ) {
    return this.recordsService.findOne(user.id, this.toBigIntId(id));
  }

  // 기록 삭제 (본인 기록만)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '운동 기록 삭제' })
  remove(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
  ) {
    return this.recordsService.remove(user.id, this.toBigIntId(id));
  }

  // 라우트 파라미터(string)를 BigInt로 변환, 숫자가 아니면 404로 처리
  private toBigIntId(id: string): bigint {
    try {
      return BigInt(id);
    } catch {
      throw new NotFoundException('기록을 찾을 수 없습니다.');
    }
  }
}
