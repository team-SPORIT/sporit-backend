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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PALETTE_KEYS } from '../../common/constants/palette.constants';
import { MAX_CATEGORIES_PER_USER } from './categories.constants';
import { CategoriesService } from './categories.service';
import {
  CategoryColorsResponseDto,
  CategoryResponseDto,
} from './dto/category-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { SetCategoryExercisesDto } from './dto/set-category-exercises.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('categories')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: '토큰이 없거나 유효하지 않음' })
@Controller('categories')
@UseGuards(SupabaseAuthGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  // 카테고리 색상 팔레트 키 목록
  @Get('colors')
  @ApiOperation({
    summary: '카테고리 색상 팔레트 조회',
    description:
      '카테고리 생성/수정에 사용할 수 있는 색상 키 목록. 실제 색상 값은 프론트에서 키에 매핑한다.',
  })
  @ApiOkResponse({ type: CategoryColorsResponseDto })
  getColors() {
    return { colors: [...PALETTE_KEYS] };
  }

  // 내 카테고리 목록 (생성순, 종목 이름 포함)
  @Get()
  @ApiOperation({
    summary: '내 카테고리 목록 조회',
    description:
      '생성순으로 정렬되며 각 카테고리에 매핑된 종목 이름을 포함한다.',
  })
  @ApiOkResponse({ type: CategoryResponseDto, isArray: true })
  findAll(@CurrentUser() user: { id: string; email: string }) {
    return this.categoriesService.findAll(user.id);
  }

  // 카테고리 생성
  @Post()
  @ApiOperation({
    summary: '카테고리 생성',
    description: `이름은 trim 후 1~20자, 색상은 팔레트 키여야 한다. 사용자당 최대 ${MAX_CATEGORIES_PER_USER}개. exerciseNames를 보내면 같은 트랜잭션에서 종목을 매핑한다.`,
  })
  @ApiCreatedResponse({ type: CategoryResponseDto })
  @ApiBadRequestResponse({
    description: '이름 길이, 팔레트에 없는 색상, 종목 이름 형식/개수 오류',
  })
  @ApiConflictResponse({
    description: `같은 이름의 카테고리가 있거나 이미 ${MAX_CATEGORIES_PER_USER}개`,
  })
  create(
    @CurrentUser() user: { id: string; email: string },
    @Body() createCategoryDto: CreateCategoryDto,
  ) {
    return this.categoriesService.create(user.id, createCategoryDto);
  }

  // 카테고리 부분 수정 (이름/색상)
  @Patch(':id')
  @ApiOperation({
    summary: '카테고리 수정 (이름/색상)',
    description: '보낸 필드만 수정한다. name과 color 둘 다 없으면 400.',
  })
  @ApiParam({ name: 'id', description: '카테고리 ID' })
  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiBadRequestResponse({
    description: '수정할 필드가 없거나 이름/색상 형식 오류',
  })
  @ApiNotFoundResponse({ description: '내 카테고리가 아니거나 없음' })
  @ApiConflictResponse({ description: '같은 이름의 카테고리가 이미 있음' })
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

  // 카테고리의 종목 목록 교체
  @Put(':id/exercises')
  @ApiOperation({
    summary: '카테고리의 종목 목록 교체 (이름 기준)',
    description:
      '카테고리의 종목 목록을 통째로 교체한다(빈 배열이면 비움). 종목 이름은 공백 정리 후 1~30자, 중복 제거, 최대 100개. 이미 다른 내 카테고리에 있던 이름은 이 카테고리로 이동한다.',
  })
  @ApiParam({ name: 'id', description: '카테고리 ID' })
  @ApiOkResponse({ type: CategoryResponseDto })
  @ApiBadRequestResponse({ description: '종목 이름 형식/개수 오류' })
  @ApiNotFoundResponse({ description: '내 카테고리가 아니거나 없음' })
  setExercises(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
    @Body() setCategoryExercisesDto: SetCategoryExercisesDto,
  ) {
    return this.categoriesService.setExercises(
      user.id,
      this.toBigIntId(id),
      setCategoryExercisesDto,
    );
  }

  // 카테고리 삭제 (매핑은 CASCADE로 함께 삭제)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: '카테고리 삭제',
    description: '카테고리에 매핑된 종목 정보도 함께 삭제된다.',
  })
  @ApiParam({ name: 'id', description: '카테고리 ID' })
  @ApiNoContentResponse({ description: '삭제 완료' })
  @ApiNotFoundResponse({ description: '내 카테고리가 아니거나 없음' })
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
