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
  kstDateToUtcRange,
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

      await this.updateGroupStreak(tx, groupId, today);

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

  // 그룹 전체 스트릭 갱신: 오늘 그룹의 "가입 당일이 아닌" 멤버 전원이 공유했으면 그룹 스트릭 +1(또는 1로 리셋)
  // 이미 오늘자로 갱신했으면 재갱신하지 않음(하루 한 번만)
  private async updateGroupStreak(
    tx: Prisma.TransactionClient,
    groupId: bigint,
    today: Date,
  ) {
    const group = await tx.groups.findUniqueOrThrow({
      where: { id: groupId },
      select: { current_streak: true, last_all_shared_date: true },
    });

    if (
      group.last_all_shared_date &&
      isSameDate(group.last_all_shared_date, today)
    ) {
      return;
    }

    const { start, end } = kstDateToUtcRange(today);

    // 오늘 가입한 멤버는 "전원 판정" 분모에서 제외
    const targetMemberCount = await tx.group_members.count({
      where: { group_id: groupId, joined_at: { lt: start } },
    });

    // 오늘 이 그룹에 공유한 서로 다른 유저 수 (record_shares에는 user_id가 없으므로 records와 join)
    const sharedUsers = await tx.record_shares.findMany({
      where: { group_id: groupId, shared_at: { gte: start, lt: end } },
      select: { records: { select: { user_id: true } } },
    });
    const sharedUserCount = new Set(
      sharedUsers.map((share) => share.records.user_id),
    ).size;

    const isAllShared = sharedUserCount >= targetMemberCount;
    if (!isAllShared) {
      return;
    }

    const nextStreak =
      group.last_all_shared_date &&
      isSameDate(group.last_all_shared_date, subtractDays(today, 1))
        ? group.current_streak + 1
        : 1;

    await tx.groups.update({
      where: { id: groupId },
      data: { current_streak: nextStreak, last_all_shared_date: today },
    });
  }
}
