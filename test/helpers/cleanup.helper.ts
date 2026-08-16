import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { deleteTestUser } from './auth.helper';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });

export interface CleanupTarget {
  userIds?: string[];
  groupIds?: bigint[];
}

// 테스트에서 만든 데이터 정리.
// groups는 owner_id FK가 NoAction이라 유저 삭제 전에 먼저 지워야 하고(멤버십/공유는 Cascade로 함께 삭제됨),
// 그 다음 auth 유저를 지우면 profiles/records/기록 통계 등은 DB의 Cascade 관계로 함께 정리된다
export async function cleanupTestData({
  userIds = [],
  groupIds = [],
}: CleanupTarget): Promise<void> {
  if (groupIds.length > 0) {
    await prisma.groups.deleteMany({ where: { id: { in: groupIds } } });
  }

  for (const userId of userIds) {
    await deleteTestUser(userId);
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
