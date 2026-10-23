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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CATEGORY_COLORS } from './categories.constants';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('categories')
@ApiBearerAuth()
@Controller('categories')
@UseGuards(SupabaseAuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  // 카테고리 색상 팔레트 키 목록
  @Get('colors')
  @ApiOperation({ summary: '카테고리 색상 팔레트 조회' })
  getColors() {
    return { colors: [...CATEGORY_COLORS] };
  }

  // 내 카테고리 목록 (생성순, 종목 이름 포함)
  @Get()
  @ApiOperation({ summary: '내 카테고리 목록 조회' })
  findAll(@CurrentUser() user: { id: string; email: string }) {
    return this.categoriesService.findAll(user.id);
  }

  // 카테고리 생성
  @Post()
  @ApiOperation({ summary: '카테고리 생성' })
  create(
    @CurrentUser() user: { id: string; email: string },
    @Body() createCategoryDto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(user.id, createCategoryDto);
  }

  // 카테고리 부분 수정 (이름/색상)
  @Patch(':id')
  @ApiOperation({ summary: '카테고리 수정 (이름/색상)' })
  update(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(
      user.id,
      this.toBigIntId(id),
      updateCategoryDto,
    );
  }

  // 카테고리 삭제 (매핑은 CASCADE로 함께 삭제)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '카테고리 삭제' })
  remove(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
  ) {
    return this.categoriesService.remove(user.id, this.toBigIntId(id));
  }

  // 라우트 파라미터(string)를 BigInt로 변환, 숫자가 아니면 404로 처리
  private toBigIntId(id: string): bigint {
    try {
      return BigInt(id);
    } catch {
      throw new NotFoundException('카테고리를 찾을 수 없습니다.');
    }
  }
}
