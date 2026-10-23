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

  // 종목 목록 조회: 기본 종목 + 내 종목. 기본 종목 먼저(id순), 내 종목은 등록순(id순)
  async findAll(userId: string) {
    const exercises = await this.prisma.exercises.findMany({
      where: { OR: [{ owner_id: null }, { owner_id: userId }] },
      orderBy: [{ owner_id: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    });

    return exercises.map((exercise) => ({
      ...exercise,
      isDefault: exercise.owner_id === null,
    }));
  }

  // 기록 작성 화면용 선택 목록: 내 개인 종목(mine) + 허용 종목이 설정된 내 그룹과 그 허용 종목(groups)
  // 기본 종목 전체와 제한 없는 그룹은 포함하지 않는다
  async findSelectable(
    userId: string,
  ): Promise<SelectableExercisesResponseDto> {
    const [myExercises, groups] = await Promise.all([
      this.prisma.exercises.findMany({
        where: { owner_id: userId },
        orderBy: { id: 'asc' },
      }),
      this.groupsService.findMyRestrictedGroupsWithExercises(userId),
    ]);

    return {
      mine: myExercises.map(({ id, name }) => ({ id, name, isDefault: false })),
      groups,
    };
  }

  // 이 종목으로 기록을 공유할 수 있는 내 그룹 목록: 허용 종목이 없는 그룹(제한 없음) 또는 이 종목이 허용된 그룹
  // 종목은 기본 종목이거나 내 종목이어야 한다 (없으면 404, 남의 개인 종목이면 403). 정렬/응답은 GET /groups와 동일
  async findGroupsForExercise(userId: string, exerciseId: bigint) {
    const exercise = await this.prisma.exercises.findUnique({
      where: { id: exerciseId },
      select: { owner_id: true },
    });
    if (!exercise) {
      throw new NotFoundException('종목을 찾을 수 없습니다.');
    }
    if (exercise.owner_id !== null && exercise.owner_id !== userId) {
      throw new ForbiddenException('사용할 수 없는 종목입니다.');
    }

    return this.groupsService.findMyGroups(userId, {
      OR: [
        { group_exercises: { none: {} } },
        { group_exercises: { some: { exercise_id: exerciseId } } },
      ],
    });
  }

  // 개인 종목 추가: 같은 이름의 기본 종목이 있거나 내 종목에 이미 있으면 409
  async create(userId: string, dto: CreateExerciseDto) {
    const defaultExercise = await this.prisma.exercises.findFirst({
      where: { owner_id: null, name: dto.name },
      select: { id: true },
    });
    if (defaultExercise) {
      throw new ConflictException('이미 존재하는 기본 종목입니다.');
    }

    try {
      const exercise = await this.prisma.exercises.create({
        data: { owner_id: userId, name: dto.name },
      });
      return { ...exercise, isDefault: false };
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

  // 개인 종목 삭제 (내 종목만): 없으면 404, 기본 종목이거나 남의 종목이면 403,
  // 기록이 참조 중이라 FK로 삭제할 수 없으면 409
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
