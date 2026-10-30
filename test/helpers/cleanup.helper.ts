import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { deleteTestUser } from './auth.helper';
import { testStorage } from './storage.helper';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });

// 유저 삭제 시 DB의 records는 Cascade로 지워지지만 버킷의 파일은 남으므로,
// 유저 삭제 전에 프로필/기록 이미지를 prefix 단위로 지운다 (탈퇴 테스트처럼 이미 지워졌어도 에러 없이 넘어간다)
async function removeUserImages(userId: string): Promise<void> {
  for (const prefix of [`profiles/${userId}/`, `records/${userId}/`]) {
    try {
      await testStorage.deleteByPrefix(prefix);
    } catch (error) {
      console.warn(
        `테스트 이미지 정리 실패 (prefix=${prefix}): ${String(error)}`,
      );
    }
  }
}

export interface CleanupTarget {
  userIds?: string[];
  groupIds?: bigint[];
}

// 테스트에서 만든 데이터 정리.
// 1) records -> exercises FK가 RESTRICT라서, 그룹 전용 종목(그룹 삭제 시 cascade)이나 개인 종목을 쓰는 기록을
//    먼저 지워야 그룹/유저 삭제가 막히지 않는다. (기록 작성자들의 기록과 버킷의 사진을 가장 먼저 정리)
// 2) groups는 owner_id FK가 NoAction이라 유저 삭제 전에 먼저 지운다 (멤버십/공유/그룹 전용 종목은 Cascade)
// 3) profiles 행을 먼저 지우면 개인 종목/기록 통계 등이 DB의 Cascade 관계로 함께 정리된다
//    (DB가 Supabase auth와 분리되어 auth 유저 삭제로는 profiles가 지워지지 않는다)
// 4) 마지막에 Supabase 계정을 지운다. 이미 삭제된 유저(탈퇴 테스트 등)는 에러 없이 넘어간다
export async function cleanupTestData({
  userIds = [],
  groupIds = [],
}: CleanupTarget): Promise<void> {
  for (const userId of userIds) {
    await removeUserImages(userId);
    await prisma.records.deleteMany({ where: { user_id: userId } });
  }

  if (groupIds.length > 0) {
    await prisma.groups.deleteMany({ where: { id: { in: groupIds } } });
  }

  for (const userId of userIds) {
    await prisma.profiles.deleteMany({ where: { id: userId } });
    await deleteTestUser(userId);
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
