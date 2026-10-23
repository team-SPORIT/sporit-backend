import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import {
  getColorHex,
  randomPaletteKey,
} from '../../common/constants/palette.constants';
import { PrismaService } from '../../prisma/prisma.service';
import {
  getKstToday,
  kstDateToUtcRange,
  parseKstDate,
} from '../../common/utils/kst-date.util';
import { CreateGroupDto } from './dto/create-group.dto';
import { JoinGroupDto } from './dto/join-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { GroupFeedResponseDto } from './dto/group-feed-response.dto';
import { GroupExercisesResponseDto } from './dto/group-exercises-response.dto';
import { SetGroupExercisesDto } from './dto/set-group-exercises.dto';

const INVITE_CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const INVITE_CODE_LENGTH = 8;
const MAX_INVITE_CODE_ATTEMPTS = 5;
const DEFAULT_MAX_MEMBERS = 10;

// 내 그룹 목록 정렬: 최근 공유순(last_shared_at 내림차순, 공유가 없으면 맨 뒤), 같으면 참여 순
const MY_GROUPS_ORDER_BY: Prisma.group_membersOrderByWithRelationInput[] = [
  { groups: { last_shared_at: { sort: 'desc', nulls: 'last' } } },
  { joined_at: 'asc' },
];

@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService) {}

  // 그룹 생성 (생성자를 owner이자 첫 멤버로 등록)
  // color(생략하면 무작위 배정)와 허용 종목(allowAll/names)을 함께 받아 하나의 트랜잭션으로 처리한다:
  // 그룹 생성, 그룹장 멤버십, 그룹 전용 종목 생성, group_exercises 연결, allow_all_exercises 설정 중 하나라도 실패하면 그룹이 만들어지지 않는다
  async create(userId: string, dto: CreateGroupDto) {
    const allowAll = dto.allowAll ?? true;
    const names = [...new Set(dto.names ?? [])];
    if (allowAll && names.length > 0) {
      throw new BadRequestException(
        'allowAll이 true이면 names를 보낼 수 없습니다. 특정 종목만 허용하려면 allowAll을 false로 보내세요.',
      );
    }
    if (!allowAll && names.length === 0) {
      throw new BadRequestException(
        '허용할 종목 이름(names)을 1개 이상 지정해야 합니다.',
      );
    }

    const inviteCode = await this.generateUniqueInviteCode();

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const created = await tx.groups.create({
        data: {
          name: dto.name,
          color: dto.color ?? randomPaletteKey(), // 색을 보내지 않으면 팔레트에서 무작위 배정
          invite_code: inviteCode,
          max_members: dto.maxMembers ?? DEFAULT_MAX_MEMBERS,
          owner_id: userId,
        },
      });

      await tx.group_members.create({
        data: { group_id: created.id, user_id: userId },
      });

      if (!allowAll) {
        await this.replaceAllowedExercises(tx, created.id, names);
      }

      // allow_all_exercises가 허용 종목 설정으로 바뀌었을 수 있어 최신 그룹 행으로 응답을 만든다
      const group = await tx.groups.findUniqueOrThrow({
        where: { id: created.id },
      });
      return {
        ...this.withColorHex(group),
        allowAll: group.allow_all_exercises,
      };
    });
  }

  // 그룹 응답에 color(팔레트 key)에 대응하는 colorHex를 덧붙인다 (그룹 응답은 DB 컬럼 키 그대로 snake_case이고,
  // 추가 필드인 memberCount처럼 colorHex는 camelCase로 둔다)
  private withColorHex<T extends { color: string }>(group: T) {
    return { ...group, colorHex: getColorHex(group.color) };
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

    return this.withColorHex(group);
  }

  // 내가 속한 그룹 목록 (MY_GROUPS_ORDER_BY 정렬)
  // groupsWhere로 그룹 조건을 더 좁힐 수 있다 (예: 특정 종목을 허용하는 그룹만)
  async findMyGroups(userId: string, groupsWhere?: Prisma.groupsWhereInput) {
    const memberships = await this.prisma.group_members.findMany({
      where: { user_id: userId, groups: groupsWhere },
      include: {
        groups: {
          include: { _count: { select: { group_members: true } } },
        },
      },
      orderBy: MY_GROUPS_ORDER_BY,
    });
    return memberships.map(({ groups }) => {
      const { _count, ...group } = groups;
      return {
        ...this.withColorHex(group),
        memberCount: _count.group_members,
      };
    });
  }

  // 그룹 수정 (그룹장만, 부분 수정): 그룹이 없으면 404, 그룹장이 아니면 403, 보낸 필드가 없으면 400
  async update(userId: string, groupId: bigint, dto: UpdateGroupDto) {
    const group = await this.prisma.groups.findUnique({
      where: { id: groupId },
      select: { owner_id: true },
    });
    if (!group) {
      throw new NotFoundException('그룹을 찾을 수 없습니다.');
    }
    if (group.owner_id !== userId) {
      throw new ForbiddenException('그룹장만 그룹 정보를 수정할 수 있습니다.');
    }
    if (dto.color === undefined) {
      throw new BadRequestException('수정할 color를 보내야 합니다.');
    }

    const updated = await this.prisma.groups.update({
      where: { id: groupId },
      data: { color: dto.color },
    });
    return this.withColorHex(updated);
  }

  // 내가 속한 그룹 중 허용 종목이 제한된(allow_all_exercises=false) 그룹과 그 허용 종목 (내 그룹 목록과 같은 정렬)
  // 그룹 목록, 허용 종목을 한 번의 쿼리로 가져온다 (N+1 방지)
  async findMyRestrictedGroupsWithExercises(userId: string) {
    const memberships = await this.prisma.group_members.findMany({
      where: { user_id: userId, groups: { allow_all_exercises: false } },
      include: {
        groups: {
          select: {
            id: true,
            name: true,
            color: true,
            group_exercises: {
              include: {
                exercises: { select: { id: true, name: true } },
              },
              orderBy: { exercise_id: 'asc' },
            },
          },
        },
      },
      orderBy: MY_GROUPS_ORDER_BY,
    });

    return memberships.map(({ groups }) => ({
      groupId: groups.id,
      groupName: groups.name,
      color: groups.color,
      colorHex: getColorHex(groups.color),
      exercises: groups.group_exercises.map(({ exercises }) => exercises),
    }));
  }

  // 그룹 상세 (멤버만 조회 가능)
  async findOne(userId: string, groupId: bigint) {
    const membership = await this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
    });
    if (!membership) {
      throw new ForbiddenException('그룹 멤버만 조회할 수 있습니다.');
    }

    const group = await this.prisma.groups.findUnique({
      where: { id: groupId },
      include: {
        group_members: {
          include: {
            profiles: { select: { nickname: true, profile_image: true } },
          },
        },
      },
    });
    return group && this.withColorHex(group);
  }

  // 그룹 허용 종목 조회 (멤버만 가능). allow_all_exercises가 true면 제한 없음
  async getExercises(
    userId: string,
    groupId: bigint,
  ): Promise<GroupExercisesResponseDto> {
    const membership = await this.prisma.group_members.findUnique({
      where: { group_id_user_id: { group_id: groupId, user_id: userId } },
    });
    if (!membership) {
      throw new ForbiddenException('그룹 멤버만 조회할 수 있습니다.');
    }

    return this.findGroupExercises(this.prisma, groupId);
  }

  // 그룹 허용 종목 설정 (그룹장만)
  // - allowAll=true: allow_all_exercises만 켠다 (group_exercises는 그대로 둠)
  // - allowAll=false: names(1개 이상 필수, 정리 후 중복 제거)로 이 그룹의 그룹 전용 종목을 find-or-create 하고,
  //   allow_all_exercises를 끈 뒤 group_exercises를 전체 교체한다.
  //   허용 목록에서 빠진 그룹 전용 종목은 삭제하지 않는다 (기록이 참조 중일 수 있음)
  async setExercises(
    userId: string,
    groupId: bigint,
    dto: SetGroupExercisesDto,
  ): Promise<GroupExercisesResponseDto> {
    const group = await this.prisma.groups.findUnique({
      where: { id: groupId },
      select: { owner_id: true },
    });
    if (!group) {
      throw new NotFoundException('그룹을 찾을 수 없습니다.');
    }
    if (group.owner_id !== userId) {
      throw new ForbiddenException('그룹장만 허용 종목을 설정할 수 있습니다.');
    }

    if (dto.allowAll) {
      await this.prisma.groups.update({
        where: { id: groupId },
        data: { allow_all_exercises: true },
      });
      return this.findGroupExercises(this.prisma, groupId);
    }

    const names = [...new Set(dto.names ?? [])];
    if (names.length === 0) {
      throw new BadRequestException(
        '허용할 종목 이름(names)을 1개 이상 지정해야 합니다.',
      );
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await this.replaceAllowedExercises(tx, groupId, names);
      return this.findGroupExercises(tx, groupId);
    });
  }

  // 허용 종목을 names로 전체 교체한다 (호출부의 트랜잭션 안에서 실행)
  // 이 그룹의 그룹 전용 종목을 이름으로 찾고 없는 이름은 새로 만든 뒤, allow_all_exercises를 끄고 group_exercises를 교체한다.
  // 이름마다 쿼리하면 트랜잭션 제한 시간(5초)을 넘길 수 있어, 조회/생성을 묶어서 처리한다 (쿼리 수가 이름 개수와 무관)
  // 허용 목록에서 빠진 그룹 전용 종목은 삭제하지 않는다 (기록이 참조 중일 수 있음)
  private async replaceAllowedExercises(
    tx: Prisma.TransactionClient,
    groupId: bigint,
    names: string[],
  ) {
    const existing = await tx.exercises.findMany({
      where: { group_id: groupId, name: { in: names } },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((exercise) => exercise.name));
    const missing = names.filter((name) => !existingNames.has(name));
    if (missing.length > 0) {
      await tx.exercises.createMany({
        data: missing.map((name) => ({ group_id: groupId, name })),
      });
    }

    const exercises = await tx.exercises.findMany({
      where: { group_id: groupId, name: { in: names } },
      select: { id: true },
    });

    await tx.groups.update({
      where: { id: groupId },
      data: { allow_all_exercises: false },
    });
    await tx.group_exercises.deleteMany({ where: { group_id: groupId } });
    await tx.group_exercises.createMany({
      data: exercises.map(({ id }) => ({ group_id: groupId, exercise_id: id })),
    });
  }

  // 그룹 허용 종목 조회 (id순). allowAll과 관계없이 저장된 허용 목록을 내려준다
  private async findGroupExercises(
    client: Prisma.TransactionClient | PrismaService,
    groupId: bigint,
  ): Promise<GroupExercisesResponseDto> {
    const group = await client.groups.findUniqueOrThrow({
      where: { id: groupId },
      select: {
        allow_all_exercises: true,
        group_exercises: {
          include: {
            exercises: { select: { id: true, name: true } },
          },
          orderBy: { exercise_id: 'asc' },
        },
      },
    });

    return {
      allowAll: group.allow_all_exercises,
      exercises: group.group_exercises.map(({ exercises }) => exercises),
    };
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
            exercises: { select: { name: true } },
          },
        },
        _count: { select: { record_reactions: true, record_comments: true } },
      },
      orderBy: { shared_at: 'asc' },
    });

    // 내가 좋아요한 공유 ID를 한 번에 조회 (공유별 쿼리 방지)
    const myReactions = await this.prisma.record_reactions.findMany({
      where: {
        user_id: userId,
        share_id: { in: shares.map((share) => share.id) },
      },
      select: { share_id: true },
    });
    const likedShareIds = new Set(myReactions.map((r) => r.share_id));

    return {
      locked: false,
      records: shares.map((share) => ({
        shareId: share.id,
        recordId: share.record_id,
        exerciseId: share.records.exercise_id,
        exerciseType: share.records.exercises.name,
        durationSec: share.records.duration_sec,
        comment: share.records.comment,
        startImageUrl: share.records.start_image_url,
        endImageUrl: share.records.end_image_url,
        recordDate: share.records.record_date,
        sharedAt: share.shared_at,
        author: {
          id: share.records.profiles.id,
          nickname: share.records.profiles.nickname,
          profileImage: share.records.profiles.profile_image,
        },
        likeCount: share._count.record_reactions,
        commentCount: share._count.record_comments,
        likedByMe: likedShareIds.has(share.id),
      })),
    };
  }

  // 공유(share)에 좋아요/댓글을 달 수 있는지 검증: 공유가 없으면 404, 그룹 멤버가 아니면 403,
  // 오늘(KST) 내가 이 그룹에 공유하지 않았다면(피드 잠금 상태) 403
  async assertShareInteractable(userId: string, shareId: bigint) {
    const share = await this.prisma.record_shares.findUnique({
      where: { id: shareId },
      select: { id: true, group_id: true },
    });
    if (!share) {
      throw new NotFoundException('공유를 찾을 수 없습니다.');
    }

    const membership = await this.prisma.group_members.findUnique({
      where: {
        group_id_user_id: { group_id: share.group_id, user_id: userId },
      },
    });
    if (!membership) {
      throw new ForbiddenException('그룹 멤버만 이용할 수 있습니다.');
    }

    const { start, end } = kstDateToUtcRange(getKstToday());
    const isUnlocked = await this.isUnlockedFor(
      userId,
      share.group_id,
      start,
      end,
    );
    if (!isUnlocked) {
      throw new ForbiddenException(
        '오늘 이 그룹에 기록을 공유해야 이용할 수 있습니다.',
      );
    }

    return share;
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
