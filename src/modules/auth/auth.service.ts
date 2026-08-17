import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface SupabaseUser {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}
  // 앱이 로그인 직후 최초 1회 호출: profiles에 없으면 새로 만들고, 있으면 그대로 반환
  async syncProfile(user: SupabaseUser) {
    let isNew = false;

    const existing = await this.prisma.profiles.findUnique({
      where: { id: user.id },
    });

    if (existing) {
      return {
        ...existing,
        isNew: isNew,
      };
    }
    isNew = true;
    // 닉네임: 구글 이름이 있으면 사용, 없으면 이메일의 @ 앞부분
    const nickname = user.name ?? user.email.split('@')[0];

    await this.prisma.profiles.create({
      data: {
        id: user.id,
        nickname,
        profile_image: user.avatar,
      },
    });

    const logginedUser = await this.prisma.profiles.findUnique({
      where: { id: user.id },
    });

    return {
      ...logginedUser,
      isNew: isNew,
    };
  }
}
