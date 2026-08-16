import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseFilePipeBuilder,
  ParseIntPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { RECORD_IMAGE_MAX_SIZE_BYTES } from './records.constants';
import { RecordsService } from './records.service';

@ApiTags('records')
@ApiBearerAuth()
@Controller('records')
@UseGuards(SupabaseAuthGuard)
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  // 운동 기록 작성 (이미지 필수, multipart/form-data)
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '운동 기록 작성' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'exerciseType'],
      properties: {
        file: { type: 'string', format: 'binary', description: '운동 사진' },
        exerciseType: { type: 'string', description: '운동 종류' },
        durationMin: { type: 'number', description: '운동 시간(분)' },
        comment: { type: 'string', description: '코멘트' },
      },
    },
  })
  create(
    @CurrentUser() user: { id: string; email: string },
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    createRecordDto: CreateRecordDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({
          fileType: /^(image\/jpeg|image\/png|image\/webp)$/,
          fallbackToMimetype: true,
        })
        .addMaxSizeValidator({ maxSize: RECORD_IMAGE_MAX_SIZE_BYTES })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    return this.recordsService.create(user.id, createRecordDto, file);
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
