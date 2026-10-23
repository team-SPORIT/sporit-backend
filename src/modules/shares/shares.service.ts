import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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

    return this.prisma.record_shares.create({
      data: { record_id: recordId, group_id: groupId },
    });
  }

  // 공유 취소 (본인이 공유한 기록만)
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
}
