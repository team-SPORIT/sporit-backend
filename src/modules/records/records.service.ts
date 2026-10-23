import { randomUUID } from 'crypto';
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { getKstToday } from '../../common/utils/kst-date.util';
import { ExercisesService } from '../exercises/exercises.service';
import { CreateRecordDto } from './dto/create-record.dto';
import type { RecordImageFiles } from './pipes/record-images.pipe';
import { MIME_TO_EXT, RECORD_IMAGES_BUCKET } from './records.constants';

// 기록 응답에 종목 이름을 함께 내려주기 위한 include
const RECORD_EXERCISE_INCLUDE = {
  exercises: { select: { name: true } },
} as const;

@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly exercisesService: ExercisesService,
  ) {}

  // 운동 기록 작성
  // 이미지 2장(시작/종료)은 트랜잭션 밖(외부 스토리지)에서 먼저 업로드하고, 기록 생성 + 종목 통계 upsert는 하나의 트랜잭션으로 묶는다
  // DB 저장이 실패하면 이미 올라간 이미지 2장을 지워 고아 파일을 남기지 않는다
  async create(userId: string, dto: CreateRecordDto, files: RecordImageFiles) {
    // 이미지 업로드 전에 종목부터 검증해 불필요한 업로드를 막는다
    const exerciseId = BigInt(dto.exerciseId);
    await this.exercisesService.assertUsableExercise(userId, exerciseId);

    const { startPath, endPath, startImageUrl, endImageUrl } =
      await this.uploadRecordImages(userId, files);
    const recordDate = getKstToday();

    try {
      return await this.createRecordInTransaction(
        userId,
        dto,
        exerciseId,
        recordDate,
        startImageUrl,
        endImageUrl,
      );
    } catch (error) {
      await this.removeFromStorage([startPath, endPath]);
      throw error;
    }
  }

  private createRecordInTransaction(
    userId: string,
    dto: CreateRecordDto,
    exerciseId: bigint,
    recordDate: Date,
    startImageUrl: string,
    endImageUrl: string,
  ) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const record = await tx.records.create({
        data: {
          user_id: userId,
          exercise_id: exerciseId,
          duration_sec: dto.durationSec,
          comment: dto.comment,
          start_image_url: startImageUrl,
          end_image_url: endImageUrl,
          record_date: recordDate,
        },
        include: RECORD_EXERCISE_INCLUDE,
      });

      await this.upsertExerciseStats(tx, userId, exerciseId, dto.durationSec);

      return this.toRecordResponse(record);
    });
  }

  // 응답에 종목 이름(exercise_type)을 평탄화해서 내려준다 (exercise_id는 기록 행에 그대로 포함)
  private toRecordResponse<T extends { exercises: { name: string } }>(
    record: T,
  ) {
    const { exercises, ...rest } = record;
    return { ...rest, exercise_type: exercises.name };
  }

  // 내 월별 기록 조회 (캘린더용), 날짜순 정렬
  async findMyRecordsByMonth(userId: string, year: number, month: number) {
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    const records = await this.prisma.records.findMany({
      where: {
        user_id: userId,
        record_date: { gte: startDate, lt: endDate },
      },
      include: RECORD_EXERCISE_INCLUDE,
      orderBy: { record_date: 'asc' },
    });

    return records.map((record) => this.toRecordResponse(record));
  }

  // 기록 상세 조회 (본인 기록만)
  async findOne(userId: string, id: bigint) {
    const record = await this.prisma.records.findUnique({
      where: { id },
      include: RECORD_EXERCISE_INCLUDE,
    });

    if (!record || record.user_id !== userId) {
      throw new NotFoundException('기록을 찾을 수 없습니다.');
    }

    return this.toRecordResponse(record);
  }

  // 기록 삭제 (본인 기록만)
  // MVP: 종목 통계 역산은 복잡하므로 이번엔 처리하지 않는다 (추후 논의)
  async remove(userId: string, id: bigint) {
    const record = await this.findOne(userId, id);

    await this.prisma.records.delete({ where: { id } });
    await this.deleteRecordImages([
      record.start_image_url,
      record.end_image_url,
    ]);
  }

  // 시작/종료 이미지를 record-images 버킷에 업로드하고 경로와 public URL 반환
  // 하나라도 실패하면 이미 올라간 파일을 지우고 에러를 던진다
  private async uploadRecordImages(userId: string, files: RecordImageFiles) {
    const storage = this.supabase
      .getClient()
      .storage.from(RECORD_IMAGES_BUCKET);
    const id = randomUUID();
    const startPath = `records/${userId}/${id}-start.${MIME_TO_EXT[files.startFile.mimetype]}`;
    const endPath = `records/${userId}/${id}-end.${MIME_TO_EXT[files.endFile.mimetype]}`;

    const uploads = [
      { path: startPath, file: files.startFile },
      { path: endPath, file: files.endFile },
    ];
    const results = await Promise.all(
      uploads.map(async ({ path, file }) => {
        try {
          const { error } = await storage.upload(path, file.buffer, {
            contentType: file.mimetype,
          });
          return !error;
        } catch {
          return false;
        }
      }),
    );

    if (results.includes(false)) {
      await this.removeFromStorage(
        uploads.filter((_, i) => results[i]).map(({ path }) => path),
      );
      throw new InternalServerErrorException('이미지 업로드에 실패했습니다.');
    }

    return {
      startPath,
      endPath,
      startImageUrl: storage.getPublicUrl(startPath).data.publicUrl,
      endImageUrl: storage.getPublicUrl(endPath).data.publicUrl,
    };
  }

  // Storage 파일 삭제 (실패해도 무시: 호출부의 본래 에러/성공 흐름을 유지)
  private async removeFromStorage(paths: string[]) {
    if (paths.length === 0) return;
    try {
      await this.supabase
        .getClient()
        .storage.from(RECORD_IMAGES_BUCKET)
        .remove(paths);
    } catch {
      // 삭제 실패는 무시
    }
  }

  // 이미지 URL들에서 버킷 내부 경로를 추출해 Storage에서 삭제 (실패해도 기록 삭제 자체는 성공 처리)
  private async deleteRecordImages(imageUrls: string[]) {
    const marker = `/${RECORD_IMAGES_BUCKET}/`;
    const paths = imageUrls
      .map((url) => {
        const index = url.indexOf(marker);
        return index === -1 ? null : url.slice(index + marker.length);
      })
      .filter((path): path is string => path !== null);

    await this.removeFromStorage(paths);
  }

  // 종목별 통계 upsert: 횟수 +1, 시간(초) 누적 (값이 없으면 0)
  // user_exercise_stats는 exercise_id 기준 내부 집계용이다. 이후 통계/캘린더/카테고리는 종목 "이름" 기준으로 쓸 예정
  private async upsertExerciseStats(
    tx: Prisma.TransactionClient,
    userId: string,
    exerciseId: bigint,
    durationSec?: number,
  ) {
    await tx.user_exercise_stats.upsert({
      where: {
        user_id_exercise_id: { user_id: userId, exercise_id: exerciseId },
      },
      create: {
        user_id: userId,
        exercise_id: exerciseId,
        total_seconds: durationSec ?? 0,
        total_count: 1,
        last_at: new Date(),
      },
      update: {
        total_seconds: { increment: durationSec ?? 0 },
        total_count: { increment: 1 },
        last_at: new Date(),
      },
    });
  }
}
