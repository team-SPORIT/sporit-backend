import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateExerciseDto } from './dto/create-exercise.dto';

@Injectable()
export class ExercisesService {
  constructor(private readonly prisma: PrismaService) {}

  // 내 종목 목록 조회 (등록 순)
  async findMe(userId: string) {
    const exercises = await this.prisma.user_exercises.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'asc' },
    });

    return exercises.map((exercise) => this.serialize(exercise));
  }

  // 종목 추가
  async create(userId: string, dto: CreateExerciseDto) {
    try {
      const exercise = await this.prisma.user_exercises.create({
        data: {
          user_id: userId,
          name: dto.name,
        },
      });

      return this.serialize(exercise);
    } catch (error) {
      // P2002: @@unique([user_id, name]) 위반 -> 이미 등록된 종목
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('이미 등록된 종목입니다.');
      }
      throw error;
    }
  }

  // 종목 삭제 (본인 소유만)
  async remove(userId: string, id: bigint) {
    const exercise = await this.prisma.user_exercises.findUnique({
      where: { id },
    });

    if (!exercise || exercise.user_id !== userId) {
      throw new NotFoundException('종목을 찾을 수 없습니다.');
    }

    await this.prisma.user_exercises.delete({ where: { id } });
  }

  // BigInt id는 JSON 직렬화가 안 되므로 문자열로 변환해서 응답
  private serialize(exercise: {
    id: bigint;
    user_id: string;
    name: string;
    created_at: Date;
  }) {
    return { ...exercise, id: exercise.id.toString() };
  }
}
