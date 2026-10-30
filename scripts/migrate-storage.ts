// Supabase Storage 공개 URL로 저장된 이미지를 Railway Bucket(S3)으로 옮기고 DB 값을 새 object key로 바꾸는 일회성 스크립트.
//
// 실행: npx ts-node scripts/migrate-storage.ts --dry-run   (대상만 출력, 업로드/DB 변경 없음)
//       npx ts-node scripts/migrate-storage.ts             (실제 이전)
// 필요한 환경변수: DATABASE_URL, S3_* (.env에서 읽는다)
//
// - 대상: profiles.profile_image, records.start_image_url / end_image_url 중 Supabase Storage 공개 URL인 값
// - 이미 key인 값, 소셜 로그인 아바타 같은 다른 외부 URL은 건너뛴다 -> 여러 번 실행해도 안전하다
// - 새 key는 원본 URL의 해시로 정해서, 업로드 후 DB 갱신 전에 중단돼도 재실행하면 같은 key를 덮어쓴다(고아 파일 없음)
// - DB는 "읽었던 원본 URL과 같을 때만" 갱신해서, 이전 중에 사용자가 이미지를 바꿨다면 덮어쓰지 않는다
// - Supabase 원본 파일은 지우지 않는다. 이전 결과를 확인한 뒤 직접 정리한다
import 'dotenv/config';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { StorageService } from '../src/common/storage/storage.service';

const DRY_RUN = process.argv.includes('--dry-run');
const PAGE_SIZE = 200;

// 예: https://xxx.supabase.co/storage/v1/object/public/profile-images/{userId}/avatar_1.jpg
const SUPABASE_PUBLIC_MARKER = '/storage/v1/object/public/';
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface Stats {
  migrated: number;
  skipped: number;
  failed: number;
}
const stats: Stats = { migrated: 0, skipped: 0, failed: 0 };

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const storage = new StorageService(new ConfigService());

function isSupabaseUrl(value: string | null): value is string {
  return (
    !!value &&
    /^https?:\/\//i.test(value) &&
    value.includes(SUPABASE_PUBLIC_MARKER)
  );
}

function extensionOf(url: string, contentType: string | null): string {
  const fromMime = MIME_TO_EXT[(contentType ?? '').split(';')[0].trim()];
  if (fromMime) return fromMime;
  const match = /\.(jpe?g|png|webp)$/i.exec(new URL(url).pathname);
  if (match) return match[1].toLowerCase().replace('jpeg', 'jpg');
  return 'jpg';
}

// 원본 URL을 내려받아 새 버킷에 올리고 새 key를 반환한다. dry-run이면 key만 계산한다.
// 실패하면 에러를 던진다 (호출부가 해당 행을 건너뛰고 계속 진행)
async function transfer(
  sourceUrl: string,
  buildKey: (hash: string, ext: string) => string,
): Promise<string> {
  const hash = createHash('sha1').update(sourceUrl).digest('hex').slice(0, 16);

  if (DRY_RUN) {
    return buildKey(hash, extensionOf(sourceUrl, null));
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`다운로드 실패 (HTTP ${response.status}): ${sourceUrl}`);
  }
  const contentType = response.headers.get('content-type') ?? 'image/jpeg';
  const key = buildKey(hash, extensionOf(sourceUrl, contentType));
  await storage.upload(
    key,
    Buffer.from(await response.arrayBuffer()),
    contentType,
  );
  return key;
}

async function migrateProfiles(): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.profiles.findMany({
      where: {
        profile_image: { contains: SUPABASE_PUBLIC_MARKER },
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, profile_image: true },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
    });
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1].id;

    for (const { id, profile_image } of rows) {
      if (!isSupabaseUrl(profile_image)) {
        stats.skipped++;
        continue;
      }
      try {
        const key = await transfer(
          profile_image,
          (hash, ext) => `profiles/${id}/${hash}.${ext}`,
        );
        console.log(`profiles ${id}: ${profile_image} -> ${key}`);
        if (!DRY_RUN) {
          await prisma.profiles.updateMany({
            where: { id, profile_image },
            data: { profile_image: key },
          });
        }
        stats.migrated++;
      } catch (error) {
        stats.failed++;
        console.error(`profiles ${id} 실패: ${String(error)}`);
      }
    }
  }
}

async function migrateRecords(): Promise<void> {
  let cursor: bigint | undefined;
  for (;;) {
    const rows = await prisma.records.findMany({
      where: {
        ...(cursor !== undefined ? { id: { gt: cursor } } : {}),
        OR: [
          { start_image_url: { contains: SUPABASE_PUBLIC_MARKER } },
          { end_image_url: { contains: SUPABASE_PUBLIC_MARKER } },
        ],
      },
      select: {
        id: true,
        user_id: true,
        start_image_url: true,
        end_image_url: true,
      },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE,
    });
    if (rows.length === 0) return;
    cursor = rows[rows.length - 1].id;

    for (const record of rows) {
      const columns = [
        {
          column: 'start_image_url',
          suffix: 'start',
          value: record.start_image_url,
        },
        { column: 'end_image_url', suffix: 'end', value: record.end_image_url },
      ] as const;

      for (const { column, suffix, value } of columns) {
        if (!isSupabaseUrl(value)) {
          stats.skipped++;
          continue;
        }
        try {
          const key = await transfer(
            value,
            (hash, ext) => `records/${record.user_id}/${hash}-${suffix}.${ext}`,
          );
          console.log(`records ${record.id} ${column}: ${value} -> ${key}`);
          if (!DRY_RUN) {
            await prisma.records.updateMany({
              where: { id: record.id, [column]: value },
              data: { [column]: key },
            });
          }
          stats.migrated++;
        } catch (error) {
          stats.failed++;
          console.error(
            `records ${record.id} ${column} 실패: ${String(error)}`,
          );
        }
      }
    }
  }
}

async function main(): Promise<void> {
  console.log(
    DRY_RUN
      ? '[dry-run] 업로드와 DB 변경 없이 대상만 출력합니다.'
      : '이미지 이전을 시작합니다.',
  );
  await migrateProfiles();
  await migrateRecords();
  console.log(
    `${DRY_RUN ? '[dry-run] ' : ''}완료: 이전 ${stats.migrated}건, 건너뜀 ${stats.skipped}건, 실패 ${stats.failed}건`,
  );
  if (stats.failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
