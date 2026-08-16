import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  getKstToday,
  kstDateToUtcRange,
  parseKstDate,
} from '../../common/utils/kst-date.util';
import { CreateGroupDto } from './dto/create-group.dto';
import { JoinGroupDto } from './dto/join-group.dto';
import { GroupFeedResponseDto } from './dto/group-feed-response.dto';

const INVITE_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const INVITE_CODE_LENGTH = 8;
const MAX_INVITE_CODE_ATTEMPTS = 5;
const DEFAULT_MAX_MEMBERS = 10;

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  // 그룹 생성 (생성자를 owner이자 첫 멤버로 등록)
  async create(userId: string, dto: CreateGroupDto) {
    const inviteCode = await this.generateUniqueInviteCode();

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const group = await tx.groups.create({
        data: {
          name: dto.name,
          invite_code: inviteCode,
          max_members: dto.maxMembers ?? DEFAULT_MAX_MEMBERS,
          owner_id: userId,
        },
      });

      await tx.group_members.create({
        data: { group_id: group.id, user_id: userId },
      });

      return group;
    });
  }

  // 초대 코드로 그룹 참여
  async join(userId: string, dto: JoinGroupDto) {
    const group = await this.prisma.groups.findUnique({
      where: { invite_code: dto.code },
    });
    if (!group) {
      throw new NotFoundException('유효하지 않은 초대 코드입니다.');
    }

    const existingMember = await this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: group.id, user_id: userId } },
    });
    if (existingMember) {
      throw new ConflictException('이미 참여한 그룹입니다.');
    }

    const memberCount = await this.prisma.group_members.count({
      where: { group_id: group.id },
    });
    if (memberCount >= group.max_members) {
      throw new BadRequestException('그룹 정원이 가득 찼습니다.');
    }

    await this.prisma.group_members.create({
      data: { group_id: group.id, user_id: userId },
    });

    return group;
  }

  // 내가 속한 그룹 목록 (참여 순)
  async findMyGroups(userId: string) {
    const memberships = await this.prisma.group_members.findMany({
      where: { user_id: userId },
      include: { groups: true },
      orderBy: { joined_at: 'asc' },
    });
    return memberships.map((membership) => membership.groups);
  }

  // 그룹 상세 (멤버만 조회 가능)
  async findOne(userId: string, groupId: bigint) {
    const membership = await this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
    });
    if (!membership) {
      throw new ForbiddenException('그룹 멤버만 조회할 수 있습니다.');
    }

    return this.prisma.groups.findUnique({
      where: { id: groupId },
      include: {
        group_members: {
          include: {
            profiles: { select: { nickname: true, profile_image: true } },
          },
        },
      },
    });
  }

  // 그룹 피드 조회 (멤버만 가능): 내가 해당 날짜에 이 그룹에 공유하지 않았으면 잠금 처리
  async getFeed(
    userId: string,
    groupId: bigint,
    dateStr?: string,
  ): Promise<GroupFeedResponseDto> {
    const membership = await this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
    });
    if (!membership) {
      throw new ForbiddenException('그룹 멤버만 조회할 수 있습니다.');
    }

    const date = dateStr ? parseKstDate(dateStr) : getKstToday();
    if (!date) {
      throw new BadRequestException('date는 YYYY-MM-DD 형식이어야 합니다.');
    }
    const { start, end } = kstDateToUtcRange(date);

    const isUnlocked = await this.isUnlockedFor(userId, groupId, start, end);
    if (!isUnlocked) {
      return { locked: true, records: [] };
    }

    const shares = await this.prisma.record_shares.findMany({
      where: { group_id: groupId, shared_at: { gte: start, lt: end } },
      include: {
        records: {
          include: {
            profiles: {
              select: { id: true, nickname: true, profile_image: true },
            },
          },
        },
        _count: { select: { record_reactions: true, record_comments: true } },
      },
      orderBy: { shared_at: 'asc' },
    });

    return {
      locked: false,
      records: shares.map((share) => ({
        shareId: share.id,
        recordId: share.record_id,
        exerciseType: share.records.exercise_type,
        durationMin: share.records.duration_min,
        comment: share.records.comment,
        photoUrl: share.records.photo_url,
        recordDate: share.records.record_date,
        sharedAt: share.shared_at,
        author: {
          id: share.records.profiles.id,
          nickname: share.records.profiles.nickname,
          profileImage: share.records.profiles.profile_image,
        },
        reactionCount: share._count.record_reactions,
        commentCount: share._count.record_comments,
      })),
    };
  }

  // 내가 해당 그룹에 [start, end) 시간 범위로 공유한 기록이 있는지 (잠금 판단용)
  private async isUnlockedFor(
    userId: string,
    groupId: bigint,
    start: Date,
    end: Date,
  ): Promise<boolean> {
    const myShare = await this.prisma.record_shares.findFirst({
      where: {
        group_id: groupId,
        shared_at: { gte: start, lt: end },
        records: { user_id: userId },
      },
      select: { id: true },
    });
    return !!myShare;
  }

  // 그룹 탈퇴
  // MVP: owner도 그냥 탈퇴 가능하며, 남은 멤버가 없어도 그룹 레코드는 유지한다.
  // (그룹 삭제/소유권 이전 정책은 추후 논의)
  async leave(userId: string, groupId: bigint) {
    try {
      await this.prisma.group_members.delete({
        where: { group_id_user_id: { group_id: groupId, user_id: userId } },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('그룹 멤버십을 찾을 수 없습니다.');
      }
      throw error;
    }
  }

  // 8자리 랜덤 초대 코드 생성, UNIQUE 충돌 시 재시도
  private async generateUniqueInviteCode(): Promise<string> {
    for (let attempt = 0; attempt < MAX_INVITE_CODE_ATTEMPTS; attempt++) {
      const code = this.randomInviteCode();
      const existing = await this.prisma.groups.findUnique({
        where: { invite_code: code },
      });
      if (!existing) return code;
    }
    throw new InternalServerErrorException(
      '초대 코드 생성에 실패했습니다. 잠시 후 다시 시도해주세요.',
    );
  }

  private randomInviteCode(): string {
    let code = '';
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
      code +=
        INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)];
    }
    return code;
  }
}
