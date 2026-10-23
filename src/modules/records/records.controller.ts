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
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateRecordDto } from './dto/create-record.dto';
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
  @ApiBody({
    schema: {
      type: 'object',
      required: ['startFile', 'endFile', 'exerciseType'],
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
        exerciseType: { type: 'string', description: '운동 종류' },
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
  @ApiQuery({ name: 'year', type: Number, example: 2026 })
  @ApiQuery({ name: 'month', type: Number, example: 8 })
  findMyRecordsByMonth(
    @CurrentUser() user: { id: string; email: string },
    @Query('year', ParseIntPipe) year: number,
    @Query('month', ParseIntPipe) month: number,
  ) {
    return this.recordsService.findMyRecordsByMonth(user.id, year, month);
  }

  // 기록 상세 조회 (본인 기록만)
  @Get(':id')
  @ApiOperation({ summary: '운동 기록 상세 조회' })
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
