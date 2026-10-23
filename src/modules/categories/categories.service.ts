import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MAX_CATEGORIES_PER_USER } from './categories.constants';
import { CreateCategoryDto } from './dto/create-category.dto';
import { SetCategoryExercisesDto } from './dto/set-category-exercises.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

// 카테고리 + 매핑된 종목 이름을 한 번에 가져오는 include (종목 이름은 이름순)
const CATEGORY_INCLUDE = {
  exercise_category_map: {
    select: { exercise_name: true },
    orderBy: { exercise_name: 'asc' },
  },
} satisfies Prisma.exercise_categoriesInclude;

type CategoryWithMap = Prisma.exercise_categoriesGetPayload<{
  include: typeof CATEGORY_INCLUDE;
}>;

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  // 내 카테고리 목록 (생성순). 매핑은 include로 한 번에 조회한다
  async findAll(userId: string) {
    const categories = await this.prisma.exercise_categories.findMany({
      where: { user_id: userId },
      include: CATEGORY_INCLUDE,
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });

    return categories.map((category) => this.toResponse(category));
  }

  // 카테고리 생성: 최대 개수 초과 409, 같은 이름 409
  async create(userId: string, dto: CreateCategoryDto) {
    try {
      const category = await this.prisma.$transaction(
        async (tx: Prisma.TransactionClient) => {
          const count = await tx.exercise_categories.count({
            where: { user_id: userId },
          });
          if (count >= MAX_CATEGORIES_PER_USER) {
            throw new ConflictException(
              `카테고리는 최대 ${MAX_CATEGORIES_PER_USER}개까지 만들 수 있습니다.`,
            );
          }

          const created = await tx.exercise_categories.create({
            data: { user_id: userId, name: dto.name, color: dto.color },
          });
          // exerciseNames가 있으면 같은 트랜잭션에서 매핑한다
          await this.replaceMappings(
            tx,
            userId,
            created.id,
            dto.exerciseNames ?? [],
          );

          return tx.exercise_categories.findUniqueOrThrow({
            where: { id: created.id },
            include: CATEGORY_INCLUDE,
          });
        },
      );
      return this.toResponse(category);
    } catch (error) {
      this.rethrowDuplicateName(error);
    }
  }

  // 카테고리 부분 수정: 보낸 필드만 수정, 둘 다 없으면 400, 내 카테고리가 아니거나 없으면 404, 이름 중복 409
  async update(userId: string, id: bigint, dto: UpdateCategoryDto) {
    if (dto.name === undefined && dto.color === undefined) {
      throw new BadRequestException('수정할 name 또는 color를 보내야 합니다.');
    }
    await this.assertOwned(userId, id);

    try {
      const category = await this.prisma.exercise_categories.update({
        where: { id },
        data: { name: dto.name, color: dto.color },
        include: CATEGORY_INCLUDE,
      });
      return this.toResponse(category);
    } catch (error) {
      this.rethrowDuplicateName(error);
    }
  }

  // 카테고리의 종목 목록을 통째로 교체 (빈 배열이면 비움). 내 카테고리가 아니거나 없으면 404
  async setExercises(userId: string, id: bigint, dto: SetCategoryExercisesDto) {
    await this.assertOwned(userId, id);

    const category = await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await this.replaceMappings(tx, userId, id, dto.exerciseNames);

        return tx.exercise_categories.findUniqueOrThrow({
          where: { id },
          include: CATEGORY_INCLUDE,
        });
      },
    );
    return this.toResponse(category);
  }

  // 이 카테고리의 종목 매핑을 names로 교체한다 (호출부의 트랜잭션 안에서 실행)
  // - 이 카테고리에 있었지만 목록에서 빠진 이름은 매핑 삭제
  // - 이미 다른 내 카테고리에 있던 이름은 이 카테고리로 이동, 없던 이름은 새로 매핑
  // 종목 이름의 존재 여부는 검증하지 않는다 (종목은 사용자/그룹마다 따로 있어 이름 기준으로만 연결)
  // 최대 100개를 처리해야 해서 이름마다 upsert하면 interactive transaction 제한 시간(5초)을 넘길 수 있다.
  // 그래서 "이 카테고리의 기존 매핑 + 이 이름들의 기존 매핑"을 한 번에 지우고 한 번에 다시 넣는다 (쿼리 3번)
  private async replaceMappings(
    tx: Prisma.TransactionClient,
    userId: string,
    categoryId: bigint,
    exerciseNames: string[],
  ) {
    const names = [...new Set(exerciseNames)];

    await tx.exercise_category_map.deleteMany({
      where: {
        user_id: userId,
        OR: [{ category_id: categoryId }, { exercise_name: { in: names } }],
      },
    });
    if (names.length > 0) {
      await tx.exercise_category_map.createMany({
        data: names.map((name) => ({
          user_id: userId,
          exercise_name: name,
          category_id: categoryId,
        })),
      });
    }
  }

  // 카테고리 삭제: 내 카테고리가 아니거나 없으면 404. 매핑은 CASCADE로 함께 삭제된다
  async remove(userId: string, id: bigint) {
    await this.assertOwned(userId, id);
    await this.prisma.exercise_categories.delete({ where: { id } });
  }

  // 내 카테고리인지 확인 (아니거나 없으면 404)
  private async assertOwned(userId: string, id: bigint) {
    const category = await this.prisma.exercise_categories.findFirst({
      where: { id, user_id: userId },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('카테고리를 찾을 수 없습니다.');
    }
  }

  // P2002(user_id, name 유니크 위반)는 409로 변환, 그 외 에러(409 포함)는 그대로 던진다
  private rethrowDuplicateName(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('이미 같은 이름의 카테고리가 있습니다.');
    }
    throw error;
  }

  // 응답 형태: { id, name, color, exerciseNames }
  private toResponse(category: CategoryWithMap) {
    return {
      id: category.id,
      name: category.name,
      color: category.color,
      exerciseNames: category.exercise_category_map.map(
        (mapping) => mapping.exercise_name,
      ),
    };
  }
}
