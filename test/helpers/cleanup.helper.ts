import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { createClient } from '@supabase/supabase-js';
import { PrismaClient } from '../../generated/prisma/client';
import { deleteTestUser } from './auth.helper';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });

const RECORD_IMAGES_BUCKET = 'record-images';
const storageClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// 유저 삭제 시 DB의 records는 Cascade로 지워지지만 Storage 파일은 남으므로,
// 유저 삭제 전에 기록의 시작/종료 사진 2장을 버킷에서 먼저 지운다
async function removeRecordImages(userId: string): Promise<void> {
  const records = await prisma.records.findMany({
    where: { user_id: userId },
    select: { start_image_url: true, end_image_url: true },
  });
  const marker = `/${RECORD_IMAGES_BUCKET}/`;
  const paths = records
    .flatMap((record) => [record.start_image_url, record.end_image_url])
    .map((url) => {
      const index = url.indexOf(marker);
      return index === -1 ? null : url.slice(index + marker.length);
    })
    .filter((path): path is string => path !== null);

  if (paths.length > 0) {
    await storageClient.storage.from(RECORD_IMAGES_BUCKET).remove(paths);
  }
}

export interface CleanupTarget {
  userIds?: string[];
  groupIds?: bigint[];
}

// 테스트에서 만든 데이터 정리.
// 1) records -> exercises FK가 RESTRICT라서, 그룹 전용 종목(그룹 삭제 시 cascade)이나 개인 종목을 쓰는 기록을
//    먼저 지워야 그룹/유저 삭제가 막히지 않는다. (기록 작성자들의 기록과 Storage 사진을 가장 먼저 정리)
// 2) groups는 owner_id FK가 NoAction이라 유저 삭제 전에 먼저 지운다 (멤버십/공유/그룹 전용 종목은 Cascade)
// 3) 마지막에 auth 유저를 지우면 profiles/개인 종목/기록 통계 등은 DB의 Cascade 관계로 함께 정리된다
export async function cleanupTestData({
  userIds = [],
  groupIds = [],
}: CleanupTarget): Promise<void> {
  for (const userId of userIds) {
    await removeRecordImages(userId);
    await prisma.records.deleteMany({ where: { user_id: userId } });
  }

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
