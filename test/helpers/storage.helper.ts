import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { StorageService } from '../../src/common/storage/storage.service';

// 앱과 같은 설정(S3_* 환경변수)의 StorageService: 테스트 정리와 presigned URL 확인용
export const testStorage = new StorageService(new ConfigService());

const listClient = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
});

// prefix 아래에 실제로 남아 있는 object key 목록 (최대 1000개)
export async function listKeys(prefix: string): Promise<string[]> {
  const result = await listClient.send(
    new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET, Prefix: prefix }),
  );
  return (result.Contents ?? []).map((object) => object.Key!);
}
