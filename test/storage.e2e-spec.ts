import 'dotenv/config';
import path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/app.helper';
import { createTestUser, getAccessToken } from './helpers/auth.helper';
import {
  cleanupTestData,
  disconnectPrisma,
  prisma,
} from './helpers/cleanup.helper';
import { listKeys, testStorage } from './helpers/storage.helper';

const TEST_IMAGE_PATH = path.join(__dirname, 'fixtures', 'test-image.png');
const runId = Date.now();

interface ProfileBody {
  id: string;
  profile_image: string | null;
}

interface RecordBody {
  id: string;
  start_image_url: string;
  end_image_url: string;
}

interface FeedBody {
  locked: boolean;
  records: {
    startImageUrl: string;
    endImageUrl: string;
    author: { profileImage: string | null };
  }[];
}

interface RecentBody {
  exercises: { records: { startImageUrl: string; endImageUrl: string }[] }[];
}

// 비공개 버킷의 이미지가 DB에는 object key로 저장되고, 응답에는 접근 가능한 presigned URL로 내려가는지 검증한다
describe('이미지 저장소 - presigned URL (e2e)', () => {
  let app: INestApplication<App>;

  const email = `sporit-e2e-storage-${runId}@example.com`;
  const password = 'Test1234!';
  let userId: string;
  let token: string;
  let groupId: string;
  let recordId: string;
  let firstAvatarKey: string;
  let startKey: string;

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const server = () => app.getHttpServer();

  // presigned URL로 직접 GET (인증 헤더 없이)
  const fetchStatus = async (url: string) => (await fetch(url)).status;

  beforeAll(async () => {
    app = await createTestApp();
    userId = (await createTestUser(email, password)).id;
    token = await getAccessToken(email, password);
    await request(server()).post('/auth/sync').set(auth());
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestData({
      userIds: [userId],
      groupIds: groupId ? [BigInt(groupId)] : [],
    });
    await disconnectPrisma();
  });

  it('1. 프로필 이미지를 올리면 DB에는 key가, 응답에는 GET 200인 presigned URL이 온다', async () => {
    const res = await request(server())
      .post('/profiles/me/avatar')
      .set(auth())
      .attach('file', TEST_IMAGE_PATH)
      .expect(201);

    const url = (res.body as ProfileBody).profile_image!;
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain('X-Amz-Signature');
    expect(await fetchStatus(url)).toBe(200);

    const row = await prisma.profiles.findUniqueOrThrow({
      where: { id: userId },
    });
    expect(row.profile_image).toMatch(
      new RegExp(`^profiles/${userId}/[0-9a-f-]+\\.png$`),
    );
    firstAvatarKey = row.profile_image!;
  });

  it('2. GET /profiles/me도 매번 접근 가능한 presigned URL을 내려준다', async () => {
    const res = await request(server())
      .get('/profiles/me')
      .set(auth())
      .expect(200);

    const url = (res.body as ProfileBody).profile_image!;
    expect(url).toContain('X-Amz-Signature');
    expect(await fetchStatus(url)).toBe(200);
  });

  it('3. 프로필 이미지를 다시 올리면 이전 파일이 삭제된다', async () => {
    await request(server())
      .post('/profiles/me/avatar')
      .set(auth())
      .attach('file', TEST_IMAGE_PATH)
      .expect(201);

    const keys = await listKeys(`profiles/${userId}/`);
    expect(keys).toHaveLength(1);
    expect(keys).not.toContain(firstAvatarKey);
  });

  it('4. PATCH /profiles/me는 외부 URL만 저장하고 key나 만료되는 presigned URL은 무시한다', async () => {
    const current = await prisma.profiles.findUniqueOrThrow({
      where: { id: userId },
    });

    // 응답으로 받은 presigned URL을 그대로 되돌려 보내도 DB의 key가 바뀌지 않는다
    const me = await request(server()).get('/profiles/me').set(auth());
    await request(server())
      .patch('/profiles/me')
      .set(auth())
      .send({ profile_image: (me.body as ProfileBody).profile_image })
      .expect(200);
    // 다른 유저의 key를 직접 넣어도 무시된다
    await request(server())
      .patch('/profiles/me')
      .set(auth())
      .send({ profile_image: 'profiles/someone-else/x.png' })
      .expect(200);
    expect(
      (await prisma.profiles.findUniqueOrThrow({ where: { id: userId } }))
        .profile_image,
    ).toBe(current.profile_image);

    // 외부 URL은 그대로 저장되고 그대로 내려간다 (이후 테스트를 위해 아바타는 되돌린다)
    const external = 'https://example.com/avatar.png';
    const res = await request(server())
      .patch('/profiles/me')
      .set(auth())
      .send({ profile_image: external })
      .expect(200);
    expect((res.body as ProfileBody).profile_image).toBe(external);
    await prisma.profiles.update({
      where: { id: userId },
      data: { profile_image: current.profile_image },
    });
  });

  it('5. 기록을 작성하면 시작/종료 사진이 key로 저장되고 응답 URL로 GET 200이다', async () => {
    const exercise = await request(server())
      .post('/exercises')
      .set(auth())
      .send({ name: '러닝' })
      .expect(201);

    const res = await request(server())
      .post('/records')
      .set(auth())
      .field('exerciseId', (exercise.body as { id: string }).id)
      .attach('startFile', TEST_IMAGE_PATH)
      .attach('endFile', TEST_IMAGE_PATH)
      .expect(201);

    const body = res.body as RecordBody;
    recordId = body.id;
    expect(await fetchStatus(body.start_image_url)).toBe(200);
    expect(await fetchStatus(body.end_image_url)).toBe(200);

    const row = await prisma.records.findUniqueOrThrow({
      where: { id: BigInt(recordId) },
    });
    expect(row.start_image_url).toMatch(
      new RegExp(`^records/${userId}/[0-9a-f-]+-start\\.png$`),
    );
    expect(row.end_image_url).toMatch(
      new RegExp(`^records/${userId}/[0-9a-f-]+-end\\.png$`),
    );
    startKey = row.start_image_url;
  });

  it('6. 최근 기록과 기록 상세도 접근 가능한 URL을 내려준다', async () => {
    const recent = await request(server())
      .get('/records/me/recent')
      .set(auth())
      .expect(200);
    const first = (recent.body as RecentBody).exercises[0].records[0];
    expect(await fetchStatus(first.startImageUrl)).toBe(200);
    expect(await fetchStatus(first.endImageUrl)).toBe(200);

    const detail = await request(server())
      .get(`/records/${recordId}`)
      .set(auth())
      .expect(200);
    expect(await fetchStatus((detail.body as RecordBody).start_image_url)).toBe(
      200,
    );
  });

  it('7. 그룹 피드의 기록 사진과 작성자 프로필 이미지가 접근 가능한 URL이다', async () => {
    const group = await request(server())
      .post('/groups')
      .set(auth())
      .send({ name: `E2E 이미지 그룹 ${runId}` })
      .expect(201);
    groupId = (group.body as { id: string }).id;
    await request(server())
      .post('/shares')
      .set(auth())
      .send({ recordId, groupId })
      .expect(201);

    const res = await request(server())
      .get(`/groups/${groupId}/feed`)
      .set(auth())
      .expect(200);
    const feed = res.body as FeedBody;
    expect(feed.locked).toBe(false);
    const item = feed.records[0];
    expect(await fetchStatus(item.startImageUrl)).toBe(200);
    expect(await fetchStatus(item.endImageUrl)).toBe(200);
    expect(await fetchStatus(item.author.profileImage!)).toBe(200);
  });

  it('8. 기록을 삭제하면 버킷의 사진도 삭제된다', async () => {
    await request(server())
      .delete(`/records/${recordId}`)
      .set(auth())
      .expect(204);

    expect(await listKeys(`records/${userId}/`)).toEqual([]);
    expect(await fetchStatus(await testStorage.getPresignedUrl(startKey))).toBe(
      404,
    );
  });
});
