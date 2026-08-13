import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  getKstToday,
  isSameDate,
  subtractDays,
} from '../../common/utils/kst-date.util';
import { CreateShareDto } from './dto/create-share.dto';

@Injectable()
export class SharesService {
  constructor(private readonly prisma: PrismaService) {}

  // 기록을 그룹에 공유 (본인 기록 + 그룹 멤버만 가능, 중복 공유 불가)
  async create(userId: string, dto: CreateShareDto) {
    const recordId = BigInt(dto.recordId);
    const groupId = BigInt(dto.groupId);

    const record = await this.prisma.records.findUnique({
      where: { id: recordId },
    });
    if (!record) {
      throw new NotFoundException('기록을 찾을 수 없습니다.');
    }
    if (record.user_id !== userId) {
      throw new ForbiddenException('본인의 기록만 공유할 수 있습니다.');
    }

    const membership = await this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
    });
    if (!membership) {
      throw new ForbiddenException('그룹 멤버만 공유할 수 있습니다.');
    }

    const existingShare = await this.prisma.record_shares.findUnique({
      where: { record_id_group_id: { record_id: recordId, group_id: groupId } },
    });
    if (existingShare) {
      throw new ConflictException('이미 이 그룹에 공유한 기록입니다.');
    }

    const today = getKstToday();

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const share = await tx.record_shares.create({
        data: { record_id: recordId, group_id: groupId },
      });

      await this.updateGroupStreak(tx, userId, groupId, today);

      return share;
    });
  }

  // 공유 취소 (본인이 공유한 기록만)
  // MVP: 그룹 스트릭 역산은 복잡하므로 이번엔 처리하지 않는다 (추후 논의)
  async remove(userId: string, shareId: bigint) {
    const share = await this.prisma.record_shares.findUnique({
      where: { id: shareId },
      include: { records: { select: { user_id: true } } },
    });
    if (!share) {
      throw new NotFoundException('공유를 찾을 수 없습니다.');
    }
    if (share.records.user_id !== userId) {
      throw new ForbiddenException('본인이 공유한 기록만 취소할 수 있습니다.');
    }

    await this.prisma.record_shares.delete({ where: { id: shareId } });
  }

  // 그룹 스트릭 갱신: 오늘 이미 공유했으면 유지, 어제 공유가 있었으면 +1, 그 외면 1로 초기화
  private async updateGroupStreak(
    tx: Prisma.TransactionClient,
    userId: string,
    groupId: bigint,
    today: Date,
  ) {
    const member = await tx.group_members.findUniqueOrThrow({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
      select: { current_streak: true, last_shared_date: true },
    });

    const { last_shared_date: lastSharedDate, current_streak: currentStreak } =
      member;

    let nextStreak: number;
    if (lastSharedDate && isSameDate(lastSharedDate, today)) {
      nextStreak = currentStreak;
    } else if (
      lastSharedDate &&
      isSameDate(lastSharedDate, subtractDays(today, 1))
    ) {
      nextStreak = currentStreak + 1;
    } else {
      nextStreak = 1;
    }

    await tx.group_members.update({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
      data: { current_streak: nextStreak, last_shared_date: today },
    });
  }
}
