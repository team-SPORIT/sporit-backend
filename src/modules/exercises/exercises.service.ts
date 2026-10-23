import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GroupsService } from '../groups/groups.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';
import { SelectableExercisesResponseDto } from './dto/selectable-exercises-response.dto';

@Injectable()
export class ExercisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groupsService: GroupsService,
  ) {}

  // 내 개인 종목 목록 (id순)
  async findAll(userId: string) {
    return this.prisma.exercises.findMany({
      where: { owner_id: userId },
      orderBy: { id: 'asc' },
    });
  }

  // 기록 작성 화면용 선택 목록: 내 개인 종목(mine)
  // + 허용 종목이 제한된(allow_all_exercises=false) 내 그룹과 그 허용 종목(groups, 그룹 전용 종목)
  async findSelectable(
    userId: string,
  ): Promise<SelectableExercisesResponseDto> {
    const [myExercises, groups] = await Promise.all([
      this.prisma.exercises.findMany({
        where: { owner_id: userId },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
      }),
      this.groupsService.findMyRestrictedGroupsWithExercises(userId),
    ]);

    return { mine: myExercises, groups };
  }

  // 기록 작성에 사용할 수 있는 종목인지 검증: 없으면 404, 사용 불가면 403
  // 사용 가능: 내 개인 종목, 내가 속한 그룹의 허용 종목(group_exercises)
  // 이후 통계/캘린더/카테고리는 종목 ID가 아니라 "이름" 기준으로 집계할 예정이다
  async assertUsableExercise(userId: string, exerciseId: bigint) {
    const exercise = await this.prisma.exercises.findUnique({
      where: { id: exerciseId },
      select: { id: true, name: true, owner_id: true },
    });
    if (!exercise) {
      throw new NotFoundException('종목을 찾을 수 없습니다.');
    }
    if (exercise.owner_id === userId) {
      return exercise;
    }

    const allowedInMyGroup = await this.prisma.group_exercises.findFirst({
      where: {
        exercise_id: exerciseId,
        groups: { group_members: { some: { user_id: userId } } },
      },
      select: { exercise_id: true },
    });
    if (!allowedInMyGroup) {
      throw new ForbiddenException('사용할 수 없는 종목입니다.');
    }
    return exercise;
  }

  // 이 종목으로 기록을 공유할 수 있는 내 그룹 목록
  // = 모든 종목을 허용하는 그룹(allow_all_exercises=true) + 이 종목과 "같은 이름"을 허용한 제한 그룹
  // 사용할 수 있는 종목이어야 한다 (없으면 404, 사용 불가면 403). 정렬/응답은 GET /groups와 동일
  async findGroupsForExercise(userId: string, exerciseId: bigint) {
    const exercise = await this.assertUsableExercise(userId, exerciseId);

    return this.groupsService.findMyGroups(userId, {
      OR: [
        { allow_all_exercises: true },
        { group_exercises: { some: { exercises: { name: exercise.name } } } },
      ],
    });
  }

  // 개인 종목 추가: 내 종목에 같은 이름이 이미 있으면 409
  async create(userId: string, dto: CreateExerciseDto) {
    try {
      const exercise = await this.prisma.exercises.create({
        data: { owner_id: userId, name: dto.name },
      });
      return exercise;
    } catch (error) {
      // P2002: (owner_id, name) 유니크 위반 -> 이미 등록된 내 종목
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('이미 등록된 종목입니다.');
      }
      throw error;
    }
  }

  // 개인 종목 삭제 (내 종목만): 없으면 404, 그룹 전용 종목이거나 남의 종목이면 403
  // (그룹 전용 종목은 owner_id가 null이라 내 종목이 아니다), 기록이 참조 중이라 FK로 삭제할 수 없으면 409
  async remove(userId: string, id: bigint) {
    const exercise = await this.prisma.exercises.findUnique({ where: { id } });
    if (!exercise) {
      throw new NotFoundException('종목을 찾을 수 없습니다.');
    }
    if (exercise.owner_id !== userId) {
      throw new ForbiddenException('내가 추가한 종목만 삭제할 수 있습니다.');
    }

    try {
      await this.prisma.exercises.delete({ where: { id } });
    } catch (error) {
      // P2003: records가 이 종목을 참조 중 (FK RESTRICT)
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException('기록이 있는 종목은 삭제할 수 없습니다.');
      }
      throw error;
    }
  }
}
