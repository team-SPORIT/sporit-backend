import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface SupabaseUser {
  id: string;
  email: string;
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  // 앱이 로그인 직후 최초 1회 호출: profiles에 없으면 새로 만들고, 있으면 그대로 반환
  async syncProfile(user: SupabaseUser) {
    const existing = await this.prisma.profiles.findUnique({
      where: { id: user.id },
    });

    if (existing) {
      return existing;
    }

    // 닉네임 임시값: 이메일의 @ 앞부분
    const tempNickname = user.email.split('@')[0];

    return this.prisma.profiles.create({
      data: {
        id: user.id,
        nickname: tempNickname,
      },
    });
  }
}
