import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CATEGORY_COLORS } from './categories.constants';
import { CategoriesService } from './categories.service';

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
}
