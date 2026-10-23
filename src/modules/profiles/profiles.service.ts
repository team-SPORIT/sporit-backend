import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { MIME_TO_EXT, PROFILE_IMAGES_BUCKET } from './profiles.constants';

@Injectable()
export class ProfilesService {
  private readonly logger = new Logger(ProfilesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
  ) {}

  // 로그인한 유저 본인의 프로필 조회
  async findMe(userId: string) {
    const profile = await this.prisma.profiles.findUnique({
      where: { id: userId },
    });

    if (!profile) {
      throw new NotFoundException('프로필을 찾을 수 없습니다.');
    }

    return profile;
  }

  // 로그인한 유저 본인의 프로필 부분 수정
  // dto의 필드가 undefined면 Prisma가 해당 컬럼을 update data에서 제외 -> 기존 값 유지
  async updateMe(userId: string, dto: UpdateProfileDto) {
    return this.prisma.profiles.update({
      where: { id: userId },
      data: dto,
    });
  }

  // 프로필 이미지 업로드 - 서버가 파일을 받아 Storage에 올리고, publicUrl을 profile_image에 저장까지 처리
  async uploadAvatar(userId: string, file: Express.Multer.File) {
    const storage = this.supabase
      .getClient()
      .storage.from(PROFILE_IMAGES_BUCKET);

    // 새 이미지를 올리기 전에 기존 이미지가 있으면 삭제 (orphan 파일 누적 방지)
    const current = await this.prisma.profiles.findUnique({
      where: { id: userId },
      select: { profile_image: true },
    });

    if (current?.profile_image) {
      const oldPath = this.extractStoragePath(current.profile_image);
      if (oldPath) {
        try {
          await storage.remove([oldPath]);
        } catch {
          // 기존 파일 삭제가 실패해도 새 업로드는 계속 진행
        }
      }
    }

    const ext = MIME_TO_EXT[file.mimetype];
    const path = `${userId}/avatar_${Date.now()}.${ext}`;

    const { error } = await storage.upload(path, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });

    if (error) {
      throw new InternalServerErrorException('이미지 업로드에 실패했습니다.');
    }

    const { data: publicUrlData } = storage.getPublicUrl(path);

    return this.prisma.profiles.update({
      where: { id: userId },
      data: { profile_image: publicUrlData.publicUrl },
    });
  }

  // 회원 탈퇴: Supabase 계정(auth.users)을 삭제하면 profiles 이하 데이터가 DB의 CASCADE로 함께 삭제된다.
  // 프로필이 이미 없는 경우(JWT는 유효하지만 계정/프로필이 없음)에도 에러 없이 성공으로 처리해 재시도해도 안전하다(멱등).
  async withdraw(userId: string) {
    await this.deleteAuthUser(userId);
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

  // profile_image의 public URL에서 버킷 내부 경로(path)를 추출
  // 예: {SUPABASE_URL}/storage/v1/object/public/profile-images/{userId}/avatar_xxx.jpg -> {userId}/avatar_xxx.jpg
  private extractStoragePath(publicUrl: string): string | null {
    const marker = `/${PROFILE_IMAGES_BUCKET}/`;
    const index = publicUrl.indexOf(marker);

    if (index === -1) {
      return null;
    }

    return publicUrl.slice(index + marker.length);
  }
}
