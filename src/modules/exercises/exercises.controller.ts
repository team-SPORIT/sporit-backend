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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExercisesService } from './exercises.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('exercises')
@ApiBearerAuth()
@Controller('exercises')
@UseGuards(SupabaseAuthGuard)
export class ExercisesController {
  constructor(private readonly exercisesService: ExercisesService) {}

  // 내 종목 목록 조회
  @Get('me')
  @ApiOperation({ summary: '내 종목 목록 조회' })
  findMe(@CurrentUser() user: { id: string; email: string }) {
    return this.exercisesService.findMe(user.id);
  }

  // 종목 추가
  @Post()
  @ApiOperation({ summary: '종목 추가' })
  create(
    @CurrentUser() user: { id: string; email: string },
    @Body() createExerciseDto: CreateExerciseDto,
  ) {
    return this.exercisesService.create(user.id, createExerciseDto);
  }

  // 종목 삭제 (본인 소유만)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '종목 삭제' })
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
