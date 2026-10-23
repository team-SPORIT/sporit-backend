import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GroupsService } from '../groups/groups.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { UpdateCommentDto } from './dto/update-comment.dto';

// 댓글 작성자 정보 (목록/작성/수정 응답에 공통 포함)
const COMMENT_INCLUDE = {
  profiles: { select: { id: true, nickname: true, profile_image: true } },
} as const;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groupsService: GroupsService,
  ) {}

  // 댓글 목록: 작성 시간순
  async findAll(userId: string, shareId: bigint) {
    await this.groupsService.assertShareInteractable(userId, shareId);

    return this.prisma.record_comments.findMany({
      where: { share_id: shareId },
      include: COMMENT_INCLUDE,
      orderBy: { created_at: 'asc' },
    });
  }

  // 댓글 작성
  async create(userId: string, shareId: bigint, dto: CreateCommentDto) {
    await this.groupsService.assertShareInteractable(userId, shareId);

    return this.prisma.record_comments.create({
      data: { share_id: shareId, user_id: userId, content: dto.content },
      include: COMMENT_INCLUDE,
    });
  }

  // 댓글 수정 (작성자만)
  async update(userId: string, commentId: bigint, dto: UpdateCommentDto) {
    await this.findOwnedComment(userId, commentId);

    return this.prisma.record_comments.update({
      where: { id: commentId },
      data: { content: dto.content, updated_at: new Date() },
      include: COMMENT_INCLUDE,
    });
  }

  // 댓글 삭제 (작성자만)
  async remove(userId: string, commentId: bigint) {
    await this.findOwnedComment(userId, commentId);

    await this.prisma.record_comments.delete({ where: { id: commentId } });
  }

  // 댓글 존재(404) -> 공유 접근 권한(멤버/잠금, 403) -> 작성자 본인 여부(403) 순으로 검증
  private async findOwnedComment(userId: string, commentId: bigint) {
    const comment = await this.prisma.record_comments.findUnique({
      where: { id: commentId },
    });
    if (!comment) {
      throw new NotFoundException('댓글을 찾을 수 없습니다.');
    }

    await this.groupsService.assertShareInteractable(userId, comment.share_id);

    if (comment.user_id !== userId) {
      throw new ForbiddenException('본인이 작성한 댓글만 처리할 수 있습니다.');
    }

    return comment;
  }
}
