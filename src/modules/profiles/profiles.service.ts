import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { MIME_TO_EXT, PROFILE_IMAGES_BUCKET } from './profiles.constants';

@Injectable()
export class ProfilesService {
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
    const storage = this.supabase.getClient().storage.from(PROFILE_IMAGES_BUCKET);

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
