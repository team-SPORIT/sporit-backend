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
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../auth/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommentsService } from './comments.service';
import { CommentResponseDto } from './dto/comment-response.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

@ApiTags('comments')
@ApiBearerAuth()
@Controller()
@UseGuards(SupabaseAuthGuard)
export class CommentsController {
  constructor(private readonly commentsService: CommentsService) {}

  // 댓글 목록 (작성 시간순)
  @Get('shares/:shareId/comments')
  @ApiOperation({ summary: '공유된 기록의 댓글 목록 조회' })
  @ApiParam({ name: 'shareId', description: '공유 ID' })
  @ApiOkResponse({ type: CommentResponseDto, isArray: true })
  @ApiForbiddenResponse({
    description: '그룹 멤버가 아니거나 오늘 공유 전(잠금)',
  })
  @ApiNotFoundResponse({ description: '공유를 찾을 수 없음' })
  findAll(
    @CurrentUser() user: { id: string; email: string },
    @Param('shareId') shareId: string,
  ) {
    return this.commentsService.findAll(
      user.id,
      this.toBigIntId(shareId, '공유를 찾을 수 없습니다.'),
    );
  }

  // 댓글 작성
  @Post('shares/:shareId/comments')
  @ApiOperation({ summary: '공유된 기록에 댓글 작성' })
  @ApiParam({ name: 'shareId', description: '공유 ID' })
  @ApiCreatedResponse({ type: CommentResponseDto })
  @ApiForbiddenResponse({
    description: '그룹 멤버가 아니거나 오늘 공유 전(잠금)',
  })
  @ApiNotFoundResponse({ description: '공유를 찾을 수 없음' })
  create(
    @CurrentUser() user: { id: string; email: string },
    @Param('shareId') shareId: string,
    @Body() createCommentDto: CreateCommentDto,
  ) {
    return this.commentsService.create(
      user.id,
      this.toBigIntId(shareId, '공유를 찾을 수 없습니다.'),
      createCommentDto,
    );
  }

  // 댓글 수정 (작성자만)
  @Patch('comments/:id')
  @ApiOperation({ summary: '댓글 수정 (작성자만)' })
  @ApiParam({ name: 'id', description: '댓글 ID' })
  @ApiOkResponse({ type: CommentResponseDto })
  @ApiForbiddenResponse({
    description: '작성자가 아니거나 멤버/잠금 조건 미충족',
  })
  @ApiNotFoundResponse({ description: '댓글을 찾을 수 없음' })
  update(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
    @Body() updateCommentDto: UpdateCommentDto,
  ) {
    return this.commentsService.update(
      user.id,
      this.toBigIntId(id, '댓글을 찾을 수 없습니다.'),
      updateCommentDto,
    );
  }

  // 댓글 삭제 (작성자만)
  @Delete('comments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '댓글 삭제 (작성자만)' })
  @ApiParam({ name: 'id', description: '댓글 ID' })
  @ApiNoContentResponse({ description: '삭제 완료' })
  @ApiForbiddenResponse({
    description: '작성자가 아니거나 멤버/잠금 조건 미충족',
  })
  @ApiNotFoundResponse({ description: '댓글을 찾을 수 없음' })
  remove(
    @CurrentUser() user: { id: string; email: string },
    @Param('id') id: string,
  ) {
    return this.commentsService.remove(
      user.id,
      this.toBigIntId(id, '댓글을 찾을 수 없습니다.'),
    );
  }

  // 라우트 파라미터(string)를 BigInt로 변환, 숫자가 아니면 404로 처리
  private toBigIntId(id: string, message: string): bigint {
    try {
      return BigInt(id);
    } catch {
      throw new NotFoundException(message);
    }
  }
}
