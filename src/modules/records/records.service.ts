import { randomUUID } from 'crypto';
import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  isExternalUrl,
  StorageService,
} from '../../common/storage/storage.service';
import {
  formatKstDate,
  getKstRecentRange,
  getKstToday,
} from '../../common/utils/kst-date.util';
import { ExercisesService } from '../exercises/exercises.service';
import { CreateRecordDto } from './dto/create-record.dto';
import type { RecordImageFiles } from './pipes/record-images.pipe';
import { RecentRecordsResponseDto } from './dto/recent-records-response.dto';
import { MIME_TO_EXT, RECENT_DAYS } from './records.constants';

// 기록 응답에 종목 이름을 함께 내려주기 위한 include
const RECORD_EXERCISE_INCLUDE = {
  exercises: { select: { name: true } },
} as const;

@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly exercisesService: ExercisesService,
  ) {}

  // 운동 기록 작성
  // 이미지 2장(시작/종료)은 트랜잭션 밖(외부 스토리지)에서 먼저 업로드하고, 기록 생성 + 종목 통계 upsert는 하나의 트랜잭션으로 묶는다
  // DB 저장이 실패하면 이미 올라간 이미지 2장을 지워 고아 파일을 남기지 않는다
  async create(userId: string, dto: CreateRecordDto, files: RecordImageFiles) {
    // 이미지 업로드 전에 종목부터 검증해 불필요한 업로드를 막는다
    const exerciseId = BigInt(dto.exerciseId);
    await this.exercisesService.assertUsableExercise(userId, exerciseId);

    const { startKey, endKey } = await this.uploadRecordImages(userId, files);
    const recordDate = getKstToday();

    let record;
    try {
      record = await this.createRecordInTransaction(
        userId,
        dto,
        exerciseId,
        recordDate,
        startKey,
        endKey,
      );
    } catch (error) {
      await this.removeFromStorage([startKey, endKey]);
      throw error;
    }
    return this.toRecordResponse(record);
  }

  // 트랜잭션은 DB 작업만 담당하고, 응답용 URL 변환(외부 호출)은 트랜잭션 밖에서 한다
  private createRecordInTransaction(
    userId: string,
    dto: CreateRecordDto,
    exerciseId: bigint,
    recordDate: Date,
    startKey: string,
    endKey: string,
  ) {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const record = await tx.records.create({
        data: {
          user_id: userId,
          exercise_id: exerciseId,
          duration_sec: dto.durationSec,
          comment: dto.comment,
          start_image_url: startKey,
          end_image_url: endKey,
          record_date: recordDate,
        },
        include: RECORD_EXERCISE_INCLUDE,
      });

      await this.upsertExerciseStats(tx, userId, exerciseId, dto.durationSec);

      return record;
    });
  }

  // 응답에 종목 이름(exercise_type)을 평탄화해서 내려준다 (exercise_id는 기록 행에 그대로 포함)
  // 시작/종료 이미지는 DB의 object key를 presigned URL로 바꿔서 내려준다
  private async toRecordResponse<
    T extends {
      exercises: { name: string };
      start_image_url: string;
      end_image_url: string;
    },
  >(record: T) {
    const { exercises, ...rest } = record;
    const [start_image_url, end_image_url] = await Promise.all([
      this.storage.resolveImageUrl(record.start_image_url),
      this.storage.resolveImageUrl(record.end_image_url),
    ]);
    return {
      ...rest,
      start_image_url: start_image_url!,
      end_image_url: end_image_url!,
      exercise_type: exercises.name,
    };
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

    return Promise.all(records.map((record) => this.toRecordResponse(record)));
  }

  // 내 최근 기록 조회: KST 오늘을 포함한 최근 RECENT_DAYS일(record_date 기준)을 종목 이름별로 묶어서 내려준다.
  // 같은 이름의 종목은 exercise_id가 달라도 한 종목으로 취급한다. 기간이 지난 기록도 DB에는 그대로 남아 있다.
  // 기록 + 종목 이름 + 공유한 그룹(record_shares)을 한 번의 쿼리로 가져오고(N+1 없음) 서버에서 이름 기준으로 묶는다
  async findMyRecentRecords(
    userId: string,
    exerciseType?: string,
  ): Promise<RecentRecordsResponseDto> {
    const { from, to } = getKstRecentRange(RECENT_DAYS);
    // exerciseType이 있으면 trim 후 그 이름과 정확히 일치하는 종목의 기록만 (공백뿐이면 필터 없음)
    const name = exerciseType?.trim();

    const records = await this.prisma.records.findMany({
      where: {
        user_id: userId,
        record_date: { gte: from, lte: to },
        ...(name ? { exercises: { name } } : {}),
      },
      include: {
        exercises: { select: { name: true } },
        record_shares: {
          select: { groups: { select: { id: true, name: true } } },
          orderBy: { shared_at: 'asc' },
        },
      },
      orderBy: [{ record_date: 'desc' }, { created_at: 'desc' }],
    });

    const byName = new Map<
      string,
      RecentRecordsResponseDto['exercises'][number]
    >();
    const imageUrls = await Promise.all(
      records.map((record) =>
        Promise.all([
          this.storage.resolveImageUrl(record.start_image_url),
          this.storage.resolveImageUrl(record.end_image_url),
        ]),
      ),
    );
    for (const [index, record] of records.entries()) {
      const exerciseType = record.exercises.name;
      const group = byName.get(exerciseType) ?? {
        exerciseType,
        count: 0,
        totalSeconds: 0,
        records: [],
      };
      group.count += 1;
      group.totalSeconds += record.duration_sec ?? 0;
      group.records.push({
        id: record.id,
        exerciseId: record.exercise_id,
        exerciseType,
        durationSec: record.duration_sec,
        comment: record.comment,
        startImageUrl: imageUrls[index][0]!,
        endImageUrl: imageUrls[index][1]!,
        recordDate: formatKstDate(record.record_date),
        createdAt: record.created_at,
        sharedGroups: record.record_shares.map(({ groups }) => ({
          groupId: groups.id,
          groupName: groups.name,
        })),
      });
      byName.set(exerciseType, group);
    }

    // 종목은 가장 최근 기록(created_at)이 최신인 순으로 정렬한다
    const exercises = [...byName.values()].sort(
      (a, b) =>
        Math.max(...b.records.map((r) => r.createdAt.getTime())) -
        Math.max(...a.records.map((r) => r.createdAt.getTime())),
    );

    return { from: formatKstDate(from), to: formatKstDate(to), exercises };
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
    // 이미지는 응답용 URL이 아닌 DB에 저장된 key가 필요하므로 원본 행을 조회한다
    const record = await this.prisma.records.findUnique({ where: { id } });
    if (!record || record.user_id !== userId) {
      throw new NotFoundException('기록을 찾을 수 없습니다.');
    }

    await this.prisma.records.delete({ where: { id } });
    await this.deleteRecordImages([
      record.start_image_url,
      record.end_image_url,
    ]);
  }

  // 시작/종료 이미지를 버킷에 업로드하고 object key를 반환 (key는 records/{userId}/ 아래에 두어 탈퇴 시 prefix로 한 번에 지운다)
  // 하나라도 실패하면 이미 올라간 파일을 지우고 에러를 던진다
  private async uploadRecordImages(userId: string, files: RecordImageFiles) {
    const id = randomUUID();
    const startKey = `records/${userId}/${id}-start.${MIME_TO_EXT[files.startFile.mimetype]}`;
    const endKey = `records/${userId}/${id}-end.${MIME_TO_EXT[files.endFile.mimetype]}`;

    const uploads = [
      { key: startKey, file: files.startFile },
      { key: endKey, file: files.endFile },
    ];
    const results = await Promise.all(
      uploads.map(async ({ key, file }) => {
        try {
          await this.storage.upload(key, file.buffer, file.mimetype);
          return true;
        } catch {
          return false;
        }
      }),
    );

    if (results.includes(false)) {
      await this.removeFromStorage(
        uploads.filter((_, i) => results[i]).map(({ key }) => key),
      );
      throw new InternalServerErrorException('이미지 업로드에 실패했습니다.');
    }

    return { startKey, endKey };
  }

  // Storage 파일 삭제 (실패해도 무시: 호출부의 본래 에러/성공 흐름을 유지)
  private async removeFromStorage(keys: string[]) {
    await Promise.all(
      keys.map(async (key) => {
        try {
          await this.storage.delete(key);
        } catch {
          // 삭제 실패는 무시
        }
      }),
    );
  }

  // 기록 삭제 시 이미지 파일 삭제 (실패해도 기록 삭제 자체는 성공 처리).
  // 외부 URL(이전 전 Supabase URL 등)은 이 버킷에 없으므로 건너뛴다
  private async deleteRecordImages(imageValues: string[]) {
    await this.removeFromStorage(
      imageValues.filter((value) => !isExternalUrl(value)),
    );
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
