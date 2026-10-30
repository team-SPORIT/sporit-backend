import { randomUUID } from 'crypto';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  isExternalUrl,
  StorageService,
} from '../../common/storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RECORD_IMAGES_BUCKET } from '../records/records.constants';
import { MIME_TO_EXT, PROFILE_IMAGES_BUCKET } from './profiles.constants';

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
    private readonly storage: StorageService,
  ) {}

  // 로그인한 유저 본인의 프로필 조회
  async findMe(userId: string) {
    const profile = await this.prisma.profiles.findUnique({
      where: { id: userId },
    });

    if (!profile) {
      throw new NotFoundException('프로필을 찾을 수 없습니다.');
    }

    return this.withImageUrl(profile);
  }

  // 로그인한 유저 본인의 프로필 부분 수정
  // dto의 필드가 undefined면 Prisma가 해당 컬럼을 update data에서 제외 -> 기존 값 유지
  async updateMe(userId: string, dto: UpdateProfileDto) {
    const { profile_image, ...rest } = dto;
    const updated = await this.prisma.profiles.update({
      where: { id: userId },
      data: {
        ...rest,
        // 이미지는 POST /profiles/me/avatar 로만 바꾼다. 여기서는 외부 http(s) URL만 받는다:
        // object key를 직접 넣으면 남의 파일에 접근하는 URL이 만들어지고, 응답으로 받은 presigned URL을 그대로 되돌려 보내면
        // 만료되는 URL이 저장되기 때문이다 (그런 값은 무시하고 기존 이미지를 유지한다)
        ...(profile_image !== undefined &&
        this.isStorableProfileUrl(profile_image)
          ? { profile_image }
          : {}),
      },
    });
    return this.withImageUrl(updated);
  }

  // 프로필 이미지 업로드 - 서버가 파일을 받아 버킷에 올리고, object key를 profile_image에 저장까지 처리
  // (응답의 profile_image는 1시간 등 짧게 유효한 presigned URL)
  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const current = await this.prisma.profiles.findUnique({
      where: { id: userId },
      select: { profile_image: true },
    });

    const key = `profiles/${userId}/${randomUUID()}.${MIME_TO_EXT[file.mimetype]}`;
    try {
      await this.storage.upload(key, file.buffer, file.mimetype);
    } catch {
      throw new InternalServerErrorException('이미지 업로드에 실패했습니다.');
    }

    let updated;
    try {
      updated = await this.prisma.profiles.update({
        where: { id: userId },
        data: { profile_image: key },
      });
    } catch (error) {
      await this.deleteImageQuietly(key); // DB 저장 실패 시 방금 올린 파일이 고아로 남지 않게 지운다
      throw error;
    }

    // 새 이미지가 저장된 뒤에 기존 이미지를 지운다 (orphan 누적 방지, 실패해도 무시).
    // 기존 값이 외부 URL(소셜 아바타, 이전 전 Supabase URL)이면 지울 파일이 없다
    if (current?.profile_image && !isExternalUrl(current.profile_image)) {
      await this.deleteImageQuietly(current.profile_image);
    }

    return this.withImageUrl(updated);
  }

  // profile_image(key 또는 외부 URL)를 응답용 URL로 바꾼다
  private async withImageUrl<T extends { profile_image: string | null }>(
    profile: T,
  ): Promise<T> {
    return {
      ...profile,
      profile_image: await this.storage.resolveImageUrl(profile.profile_image),
    };
  }

  // PATCH로 저장해도 되는 값인지: 외부 http(s) URL이면서 이 버킷의 presigned URL(서명 포함)이 아닌 것
  private isStorableProfileUrl(value: string): boolean {
    return isExternalUrl(value) && !value.includes('X-Amz-Signature');
  }

  private async deleteImageQuietly(key: string) {
    try {
      await this.storage.delete(key);
    } catch {
      // 삭제 실패는 무시
    }
  }

  // 회원 탈퇴 처리 순서 (DB는 Supabase가 아닌 Railway PostgreSQL이라 auth.users 삭제가 profiles로 CASCADE되지 않는다):
  // 1. [DB 트랜잭션] 내가 그룹장인 그룹 정리 (위임/삭제가 끝난 그룹은 더 이상 내 그룹이 아니므로 재실행해도 안전)
  // 2. profiles 행 삭제 -> 기록/댓글/좋아요/통계 등 나머지 데이터는 DB의 CASCADE로 함께 삭제.
  //    (삭제 전에 Storage 삭제 대상(프로필/기록 사진) 경로를 미리 조회: 행이 지워져도 Storage는 폴더 기준이라 재시도 시에도 조회 가능)
  // 3. Supabase 계정 삭제(auth.admin.deleteUser). 실패하면 500
  // 4. 계정 삭제가 성공한 뒤 Storage 사진 삭제. 실패해도 예외를 던지지 않고 경고 로그만 남긴다(탈퇴는 성공으로 응답)
  // 3에서 실패해도 JWT가 유효한 채로 재요청하면 1·2는 대상이 없어 no-op이고 3부터 다시 시도하므로 재시도해도 안전하다(멱등).
  async withdraw(userId: string) {
    await this.handleOwnedGroups(userId);
    const storageTargets = await this.collectStorageTargets(userId);
    await this.deleteProfile(userId);
    await this.deleteAuthUser(userId);
    await this.cleanupStorage(userId, storageTargets);
  }

  // profiles 행 삭제. 이미 없으면 0건 삭제로 끝나므로 재시도해도 에러가 없다
  private async deleteProfile(userId: string) {
    await this.prisma.profiles.deleteMany({ where: { id: userId } });
  }

  // 내가 그룹장(owner_id)인 모든 그룹을 처리한다. 그룹장이 지워지면 groups가 CASCADE로 통째로 삭제되어
  // 다른 멤버의 공유/댓글까지 사라지므로, 계정을 지우기 전에 먼저 처리해야 한다.
  // - 다른 멤버가 있으면: 가장 먼저 가입한 멤버(joined_at 오름차순, 같으면 user_id 오름차순)에게 그룹장을 위임
  // - 나 혼자뿐이면: 그룹 삭제
  private async handleOwnedGroups(userId: string) {
    await this.prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const ownedGroups = await tx.groups.findMany({
          where: { owner_id: userId },
          select: { id: true },
        });

        for (const { id: groupId } of ownedGroups) {
          const nextOwner = await tx.group_members.findFirst({
            where: { group_id: groupId, user_id: { not: userId } },
            orderBy: [{ joined_at: 'asc' }, { user_id: 'asc' }],
            select: { user_id: true },
          });

          if (nextOwner) {
            await tx.groups.update({
              where: { id: groupId },
              data: { owner_id: nextOwner.user_id },
            });
          } else {
            // 그룹 전용 종목은 그룹 삭제 시 함께 지워지는데 기록이 참조 중이면(RESTRICT) 삭제가 막히므로
            // 먼저 기록/통계를 작성자의 개인 종목으로 옮긴다
            await this.migrateGroupExercisesToPersonal(tx, groupId);
            await tx.groups.delete({ where: { id: groupId } });
          }
        }
      },
      // 그룹이 많은 경우를 고려해 기본 제한 시간(5초)보다 넉넉하게 둔다
      { timeout: 30_000 },
    );
  }

  // 삭제할 Storage 파일 경로를 버킷별로 조회한다. 조회에 실패해도 탈퇴를 막지 않고 경고만 남긴다.
  // - profile-images: {userId}/ 폴더 (아바타)
  // - record-images: records/{userId}/ 폴더 (기록 사진), 그리고 예전 업로드 규칙의 {userId}/ 폴더
  private async collectStorageTargets(
    userId: string,
  ): Promise<{ bucket: string; paths: string[] }[]> {
    const folders = [
      { bucket: PROFILE_IMAGES_BUCKET, folder: userId },
      { bucket: RECORD_IMAGES_BUCKET, folder: `records/${userId}` },
      { bucket: RECORD_IMAGES_BUCKET, folder: userId },
    ];

    const targets: { bucket: string; paths: string[] }[] = [];
    for (const { bucket, folder } of folders) {
      try {
        const paths = await this.listFolderFiles(bucket, folder);
        if (paths.length > 0) targets.push({ bucket, paths });
      } catch (error) {
        this.logger.warn(
          `Storage 목록 조회 실패 (bucket=${bucket}, userId=${userId}): ${this.errorMessage(error)}`,
        );
      }
    }
    return targets;
  }

  // 폴더 안의 파일 경로를 페이지 단위로 모두 조회한다 (폴더 항목은 id가 null이라 제외)
  private async listFolderFiles(
    bucket: string,
    folder: string,
  ): Promise<string[]> {
    const storage = this.supabase.getClient().storage.from(bucket);
    const pageSize = 100;
    const paths: string[] = [];

    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await storage.list(folder, {
        limit: pageSize,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;

      for (const item of data) {
        if (item.id) paths.push(`${folder}/${item.name}`);
      }
      if (data.length < pageSize) break;
    }
    return paths;
  }

  // 계정 삭제 성공 후 Storage 사진을 지운다. 실패해도 예외를 던지지 않고 경고 로그만 남긴다
  private async cleanupStorage(
    userId: string,
    targets: { bucket: string; paths: string[] }[],
  ) {
    const chunkSize = 100;
    for (const { bucket, paths } of targets) {
      const storage = this.supabase.getClient().storage.from(bucket);
      for (let i = 0; i < paths.length; i += chunkSize) {
        try {
          const { error } = await storage.remove(paths.slice(i, i + chunkSize));
          if (error) throw error;
        } catch (error) {
          this.logger.warn(
            `Storage 파일 삭제 실패 (bucket=${bucket}, userId=${userId}): ${this.errorMessage(error)}`,
          );
        }
      }
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  // 그룹 전용 종목(exercises.group_id)을 참조하는 기록과 종목 통계를 작성자별 "같은 이름의 개인 종목"으로 옮긴다.
  // 작성자에게 같은 이름의 개인 종목이 없으면 새로 만든다. 탈퇴하는 그룹장 본인의 기록도 같은 방식으로 옮긴다
  // (기록을 삭제하지 않고 이관해야 이후 profiles CASCADE로 지워질 때 다른 멤버의 공유/통계에 영향이 없다).
  // 통계는 작성자에게 같은 이름의 개인 종목 통계가 이미 있으면 합산(total_seconds, total_count)하고 last_at은 더 최근 값을 쓴다.
  private async migrateGroupExercisesToPersonal(
    tx: Prisma.TransactionClient,
    groupId: bigint,
  ) {
    const groupExercises = await tx.exercises.findMany({
      where: { group_id: groupId },
      select: { id: true, name: true },
    });
    if (groupExercises.length === 0) return;

    const exerciseIds = groupExercises.map((exercise) => exercise.id);
    const nameById = new Map(
      groupExercises.map((exercise) => [exercise.id, exercise.name]),
    );

    // 이 종목들을 쓴 (작성자, 종목) 조합: 기록 또는 통계가 있는 모든 경우
    const usedByRecords = await tx.records.findMany({
      where: { exercise_id: { in: exerciseIds } },
      select: { user_id: true, exercise_id: true },
      distinct: ['user_id', 'exercise_id'],
    });
    const stats = await tx.user_exercise_stats.findMany({
      where: { exercise_id: { in: exerciseIds } },
    });
    const pairs = new Map<string, { userId: string; exerciseId: bigint }>();
    for (const { user_id, exercise_id } of [...usedByRecords, ...stats]) {
      pairs.set(`${user_id}:${exercise_id}`, {
        userId: user_id,
        exerciseId: exercise_id,
      });
    }

    for (const { userId, exerciseId } of pairs.values()) {
      const name = nameById.get(exerciseId)!;
      const personalId = await this.findOrCreatePersonalExercise(
        tx,
        userId,
        name,
      );

      await tx.records.updateMany({
        where: { user_id: userId, exercise_id: exerciseId },
        data: { exercise_id: personalId },
      });

      const source = stats.find(
        (row) => row.user_id === userId && row.exercise_id === exerciseId,
      );
      if (!source) continue;

      const target = await tx.user_exercise_stats.findUnique({
        where: {
          user_id_exercise_id: { user_id: userId, exercise_id: personalId },
        },
      });
      if (target) {
        await tx.user_exercise_stats.update({
          where: {
            user_id_exercise_id: { user_id: userId, exercise_id: personalId },
          },
          data: {
            total_seconds: target.total_seconds + source.total_seconds,
            total_count: target.total_count + source.total_count,
            last_at: this.latest(target.last_at, source.last_at),
          },
        });
        await tx.user_exercise_stats.delete({
          where: {
            user_id_exercise_id: { user_id: userId, exercise_id: exerciseId },
          },
        });
      } else {
        await tx.user_exercise_stats.update({
          where: {
            user_id_exercise_id: { user_id: userId, exercise_id: exerciseId },
          },
          data: { exercise_id: personalId },
        });
      }
    }
  }

  // 작성자의 같은 이름 개인 종목을 찾고, 없으면 만든다
  private async findOrCreatePersonalExercise(
    tx: Prisma.TransactionClient,
    ownerId: string,
    name: string,
  ): Promise<bigint> {
    const existing = await tx.exercises.findFirst({
      where: { owner_id: ownerId, name },
      select: { id: true },
    });
    if (existing) return existing.id;

    const created = await tx.exercises.create({
      data: { owner_id: ownerId, name },
      select: { id: true },
    });
    return created.id;
  }

  // 두 시각 중 더 최근 값 (null이면 다른 쪽)
  private latest(a: Date | null, b: Date | null): Date | null {
    if (!a) return b;
    if (!b) return a;
    return a > b ? a : b;
  }

  // Supabase 계정 삭제(service_role). 이미 없는 계정이면 성공으로 보고, 그 외 실패는 500으로 던져 탈퇴 실패를 알린다
  private async deleteAuthUser(userId: string) {
    const { error } = await this.supabase
      .getClient()
      .auth.admin.deleteUser(userId);

    if (!error) return;

    if (error.status === 404 || error.code === 'user_not_found') {
      return; // 이미 삭제된 계정 -> 멱등하게 성공 처리
    }

    // 토큰 등 민감 정보는 로그에 남기지 않고 상태/코드만 남긴다
    this.logger.error(
      `계정 삭제 실패 (userId=${userId}, status=${error.status}, code=${error.code})`,
    );
    throw new InternalServerErrorException('회원 탈퇴에 실패했습니다.');
  }
}
