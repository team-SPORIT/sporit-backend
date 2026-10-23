import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { GroupsService } from '../groups/groups.service';

@Injectable()
export class ReactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groupsService: GroupsService,
  ) {}

  // 좋아요: 이미 눌렀어도 에러 없이 성공 (upsert)
  async like(userId: string, shareId: bigint) {
    await this.groupsService.assertShareInteractable(userId, shareId);

    await this.prisma.record_reactions.upsert({
      where: { share_id_user_id: { share_id: shareId, user_id: userId } },
      create: { share_id: shareId, user_id: userId },
      update: {},
    });
  }

  // 좋아요 취소: 누르지 않았어도 에러 없이 성공 (deleteMany)
  async unlike(userId: string, shareId: bigint) {
    await this.groupsService.assertShareInteractable(userId, shareId);

    await this.prisma.record_reactions.deleteMany({
      where: { share_id: shareId, user_id: userId },
    });
  }
}
