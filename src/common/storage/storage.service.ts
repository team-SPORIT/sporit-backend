import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// presigned URL 기본 만료 시간(초): 1시간
const DEFAULT_URL_EXPIRES_SEC = 3600;
// S3 DeleteObjects는 한 번에 최대 1000개까지 지울 수 있다
const DELETE_BATCH_SIZE = 1000;

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly urlExpiresSec: number;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.getOrThrow<string>('S3_BUCKET');
    this.urlExpiresSec =
      Number(this.config.get('S3_URL_EXPIRES_SEC')) || DEFAULT_URL_EXPIRES_SEC;

    this.client = new S3Client({
      endpoint: this.config.getOrThrow<string>('S3_ENDPOINT'),
      region: this.config.get<string>('S3_REGION') || 'auto',
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>(
          'S3_SECRET_ACCESS_KEY',
        ),
      },
      // 접속이 안 되면 S3_FORCE_PATH_STYLE=true 로 바꿔 시도한다 (기본은 가상 호스트 방식)
      forcePathStyle: this.config.get('S3_FORCE_PATH_STYLE') === 'true',
    });
  }

  // 객체 업로드 (같은 key가 있으면 덮어쓴다). 실패하면 에러를 던진다
  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  // 객체 하나 삭제 (없는 key여도 성공)
  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  // prefix로 시작하는 객체를 모두 삭제하고 지운 개수를 반환한다.
  // prefix가 비어 있으면 버킷 전체가 지워지므로 거부한다. 폴더 경계를 지키려면 "profiles/{userId}/"처럼 '/'로 끝내 넘긴다
  async deleteByPrefix(prefix: string): Promise<number> {
    if (!prefix) {
      throw new Error('deleteByPrefix에는 빈 prefix를 쓸 수 없습니다.');
    }

    let deleted = 0;
    let continuationToken: string | undefined;
    do {
      const listed = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      const keys = (listed.Contents ?? [])
        .map((object) => object.Key)
        .filter((key): key is string => !!key);
      for (let i = 0; i < keys.length; i += DELETE_BATCH_SIZE) {
        const result = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: {
              Objects: keys
                .slice(i, i + DELETE_BATCH_SIZE)
                .map((Key) => ({ Key })),
              Quiet: true,
            },
          }),
        );
        // Quiet 모드에서는 실패한 항목만 Errors로 돌아온다
        if (result.Errors?.length) {
          throw new Error(
            `객체 ${result.Errors.length}개 삭제 실패: ${result.Errors[0].Message}`,
          );
        }
        deleted += Math.min(DELETE_BATCH_SIZE, keys.length - i);
      }

      continuationToken = listed.IsTruncated
        ? listed.NextContinuationToken
        : undefined;
    } while (continuationToken);

    return deleted;
  }

  // 비공개 버킷의 객체를 읽을 수 있는 임시 GET URL (기본 1시간 후 만료, S3_URL_EXPIRES_SEC로 조절)
  getPresignedUrl(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: this.urlExpiresSec },
    );
  }
}
