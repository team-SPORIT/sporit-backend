import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  getKstToday,
  isSameDate,
  subtractDays,
} from '../../common/utils/kst-date.util';
import { CreateRecordDto } from './dto/create-record.dto';
import { MIME_TO_EXT, RECORD_IMAGES_BUCKET } from './records.constants';

@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
  ) {}

  // 운동 기록 작성
  // 이미지는 트랜잭션 밖(외부 스토리지)에서 먼저 업로드하고, 기록 생성 + 스트릭 갱신 + 종목 통계 upsert는 하나의 트랜잭션으로 묶는다
  async create(
    userId: string,
    dto: CreateRecordDto,
    file: Express.Multer.File,
  ) {
    const photoUrl = await this.uploadRecordImage(userId, file);
    const recordDate = getKstToday();

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const record = await tx.records.create({
        data: {
          user_id: userId,
          exercise_type: dto.exerciseType,
          duration_min: dto.durationMin,
          comment: dto.comment,
          photo_url: photoUrl,
          record_date: recordDate,
        },
      });

      await this.updateStreak(tx, userId, recordDate);
      await this.upsertExerciseStats(
        tx,
        userId,
        dto.exerciseType,
        dto.durationMin,
      );

      return record;
    });
  }

  // 내 월별 기록 조회 (캘린더용), 날짜순 정렬
  async findMyRecordsByMonth(userId: string, year: number, month: number) {
    const startDate = new Date(Date.UTC(year, month - 1, 1));
    const endDate = new Date(Date.UTC(year, month, 1));

    return this.prisma.records.findMany({
      where: {
        user_id: userId,
        record_date: { gte: startDate, lt: endDate },
      },
      orderBy: { record_date: 'asc' },
    });
  }

  // 기록 상세 조회 (본인 기록만)
  async findOne(userId: string, id: bigint) {
    const record = await this.prisma.records.findUnique({ where: { id } });

    if (!record || record.user_id !== userId) {
      throw new NotFoundException('기록을 찾을 수 없습니다.');
    }

    return record;
  }

  // 기록 삭제 (본인 기록만)
  // MVP: 스트릭/종목 통계 역산은 복잡하므로 이번엔 처리하지 않는다 (추후 논의)
  async remove(userId: string, id: bigint) {
    const record = await this.findOne(userId, id);

    await this.prisma.records.delete({ where: { id } });
    await this.deleteRecordImage(record.photo_url);
  }

  // 기록 이미지를 record-images 버킷에 업로드하고 public URL 반환
  private async uploadRecordImage(
    userId: string,
    file: Express.Multer.File,
  ): Promise<string> {
    const storage = this.supabase
      .getClient()
      .storage.from(RECORD_IMAGES_BUCKET);
    const ext = MIME_TO_EXT[file.mimetype];
    const path = `${userId}/record_${Date.now()}.${ext}`;

    const { error } = await storage.upload(path, file.buffer, {
      contentType: file.mimetype,
    });

    if (error) {
      throw new InternalServerErrorException('이미지 업로드에 실패했습니다.');
    }

    const { data } = storage.getPublicUrl(path);
    return data.publicUrl;
  }

  // photo_url에서 버킷 내부 경로를 추출해 Storage에서 삭제 (실패해도 기록 삭제 자체는 성공 처리)
  private async deleteRecordImage(photoUrl: string) {
    const marker = `/${RECORD_IMAGES_BUCKET}/`;
    const index = photoUrl.indexOf(marker);
    if (index === -1) return;

    const path = photoUrl.slice(index + marker.length);
    const storage = this.supabase
      .getClient()
      .storage.from(RECORD_IMAGES_BUCKET);
    try {
      await storage.remove([path]);
    } catch {
      // 이미지 삭제 실패는 무시
    }
  }

  // 개인 스트릭 갱신: 오늘 이미 기록했으면 유지, 어제 기록이 있었으면 +1, 그 외(하루 이상 걸렀거나 첫 기록)면 1로 초기화
  private async updateStreak(
    tx: Prisma.TransactionClient,
    userId: string,
    today: Date,
  ) {
    const profile = await tx.profiles.findUnique({
      where: { id: userId },
      select: { current_streak: true, last_record_date: true },
    });
    if (!profile) {
      throw new NotFoundException('프로필을 찾을 수 없습니다.');
    }

    const { last_record_date: lastRecordDate, current_streak: currentStreak } =
      profile;

    let nextStreak: number;
    if (lastRecordDate && isSameDate(lastRecordDate, today)) {
      nextStreak = currentStreak;
    } else if (
      lastRecordDate &&
      isSameDate(lastRecordDate, subtractDays(today, 1))
    ) {
      nextStreak = currentStreak + 1;
    } else {
      nextStreak = 1;
    }

    await tx.profiles.update({
      where: { id: userId },
      data: { current_streak: nextStreak, last_record_date: today },
    });
  }

  // 종목별 통계 upsert: 횟수 +1, 시간 누적
  private async upsertExerciseStats(
    tx: Prisma.TransactionClient,
    userId: string,
    exerciseType: string,
    durationMin?: number,
  ) {
    await tx.user_exercise_stats.upsert({
      where: {
        user_id_exercise_type: { user_id: userId, exercise_type: exerciseType },
      },
      create: {
        user_id: userId,
        exercise_type: exerciseType,
        total_minutes: durationMin ?? 0,
        total_count: 1,
        last_at: new Date(),
      },
      update: {
        total_minutes: { increment: durationMin ?? 0 },
        total_count: { increment: 1 },
        last_at: new Date(),
      },
    });
  }
}
