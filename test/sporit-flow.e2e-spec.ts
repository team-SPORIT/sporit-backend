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

const TEST_IMAGE_PATH = path.join(__dirname, 'fixtures', 'test-image.png');
const runId = Date.now();

interface ProfileResponse {
  id: string;
}

interface GroupResponse {
  id: string;
  invite_code: string;
}

interface GroupDetailResponse {
  id: string;
  last_shared_at: string | null;
}

interface RecordResponse {
  id: string;
  duration_sec: number;
  start_image_url: string;
  end_image_url: string;
}

interface FeedShare {
  author: { id: string };
  durationSec: number | null;
  startImageUrl: string;
  endImageUrl: string;
}

interface FeedResponse {
  locked: boolean;
  records: FeedShare[];
}

// 로그인 -> 그룹 생성/참여 -> 기록 작성 -> 공유 -> 그룹 피드 잠금 해제로 이어지는 핵심 플로우를
// 실제 HTTP 요청 + 실제 Supabase 인증으로 검증한다
describe('스포릿 핵심 플로우 (e2e)', () => {
  let app: INestApplication<App>;

  const userA = {
    email: `sporit-e2e-a-${runId}@example.com`,
    password: 'Test1234!',
  };
  const userB = {
    email: `sporit-e2e-b-${runId}@example.com`,
    password: 'Test1234!',
  };

  let userAId: string;
  let userBId: string;
  let tokenA: string;
  let tokenB: string;

  let groupId: string;
  let inviteCode: string;
  let recordId: string;
  const extraUserIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();

    const createdA = await createTestUser(userA.email, userA.password);
    const createdB = await createTestUser(userB.email, userB.password);
    userAId = createdA.id;
    userBId = createdB.id;

    tokenA = await getAccessToken(userA.email, userA.password);
    tokenB = await getAccessToken(userB.email, userB.password);
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestData({
      userIds: [userAId, userBId, ...extraUserIds],
      groupIds: groupId ? [BigInt(groupId)] : [],
    });
    await disconnectPrisma();
  });

  it('1. A, B가 각각 POST /auth/sync 하면 프로필이 생성된다', async () => {
    const resA = await request(app.getHttpServer())
      .post('/auth/sync')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    expect((resA.body as ProfileResponse).id).toBe(userAId);

    const resB = await request(app.getHttpServer())
      .post('/auth/sync')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(201);
    expect((resB.body as ProfileResponse).id).toBe(userBId);
  });

  it('2. A가 POST /groups 하면 그룹이 생성되고 초대코드가 발급된다', async () => {
    const res = await request(app.getHttpServer())
      .post('/groups')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: `E2E 테스트 그룹 ${runId}` })
      .expect(201);

    const body = res.body as GroupResponse;
    expect(body.id).toBeDefined();
    expect(body.invite_code).toHaveLength(8);

    groupId = body.id;
    inviteCode = body.invite_code;
  });

  it('3. B가 초대코드로 POST /groups/join 하면 그룹에 참여한다', async () => {
    const res = await request(app.getHttpServer())
      .post('/groups/join')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ code: inviteCode })
      .expect(201);

    expect((res.body as GroupResponse).id).toBe(groupId);
  });

  it('3-1. 소문자로 바꾼 초대코드로 POST /groups/join 하면 대소문자 구분 없이 참여한다', async () => {
    const joiner = await createTestUser(
      `sporit-e2e-case-${runId}@example.com`,
      'Test1234!',
    );
    const token = await getAccessToken(joiner.email, 'Test1234!');
    extraUserIds.push(joiner.id);
    await request(app.getHttpServer())
      .post('/auth/sync')
      .set('Authorization', `Bearer ${token}`);

    // 앞뒤 공백이 있어도 trim 되어 참여한다 (소문자 + 공백)
    const res = await request(app.getHttpServer())
      .post('/groups/join')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: `  ${inviteCode.toLowerCase()}  ` })
      .expect(201);
    expect((res.body as GroupResponse).id).toBe(groupId);

    // 이미 참여한 그룹에 소문자 코드로 다시 참여하면 409
    await request(app.getHttpServer())
      .post('/groups/join')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: inviteCode.toLowerCase() })
      .expect(409);
  });

  it('3-2. 소문자만으로 된 초대코드로 참여한다 (공백 없음)', async () => {
    const joiner = await createTestUser(
      `sporit-e2e-lower-${runId}@example.com`,
      'Test1234!',
    );
    const token = await getAccessToken(joiner.email, 'Test1234!');
    extraUserIds.push(joiner.id);
    await request(app.getHttpServer())
      .post('/auth/sync')
      .set('Authorization', `Bearer ${token}`);

    await request(app.getHttpServer())
      .post('/groups/join')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: inviteCode.toLowerCase() })
      .expect(201);
  });

  it('3-3. 존재하지 않는 코드(소문자)는 404이다', async () => {
    await request(app.getHttpServer())
      .post('/groups/join')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ code: 'zzzzzzzz' })
      .expect(404);
  });

  it('4. A가 GET /groups/:id/feed 하면 아직 공유 전이라 잠겨 있다', async () => {
    const res = await request(app.getHttpServer())
      .get(`/groups/${groupId}/feed`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body as FeedResponse).toEqual({ locked: true, records: [] });
  });

  it('5. A가 POST /records(사진 포함)로 기록을 작성한다', async () => {
    const res = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('exerciseType', '러닝')
      .field('durationSec', '1800')
      .attach('startFile', TEST_IMAGE_PATH)
      .attach('endFile', TEST_IMAGE_PATH)
      .expect(201);

    const body = res.body as RecordResponse;
    expect(body.id).toBeDefined();
    expect(body.duration_sec).toBe(1800);
    expect(body.start_image_url).toEqual(expect.any(String));
    expect(body.end_image_url).toEqual(expect.any(String));
    expect(body.start_image_url).not.toBe(body.end_image_url);
    recordId = body.id;
  });

  it('5-2. 기록 생성 후 user_exercise_stats.total_seconds가 durationSec만큼 증가한다', async () => {
    const stats = await prisma.user_exercise_stats.findUnique({
      where: {
        user_id_exercise_type: { user_id: userAId, exercise_type: '러닝' },
      },
    });

    expect(stats?.total_seconds).toBe(1800);
    expect(stats?.total_count).toBe(1);
  });

  it('5-3. durationSec가 음수이거나 86401 이상이면 POST /records는 400이다', async () => {
    for (const durationSec of ['-1', '86401']) {
      await request(app.getHttpServer())
        .post('/records')
        .set('Authorization', `Bearer ${tokenA}`)
        .field('exerciseType', '러닝')
        .field('durationSec', durationSec)
        .attach('startFile', TEST_IMAGE_PATH)
        .attach('endFile', TEST_IMAGE_PATH)
        .expect(400);
    }
  });

  it('5-1. startFile 또는 endFile 한쪽만 보내면 POST /records는 400이다', async () => {
    await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('exerciseType', '러닝')
      .attach('startFile', TEST_IMAGE_PATH)
      .expect(400);

    await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('exerciseType', '러닝')
      .attach('endFile', TEST_IMAGE_PATH)
      .expect(400);
  });

  it('6. A가 POST /shares로 공유하면 그룹의 last_shared_at이 갱신된다', async () => {
    await request(app.getHttpServer())
      .post('/shares')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ recordId, groupId })
      .expect(201);

    const groupRes = await request(app.getHttpServer())
      .get(`/groups/${groupId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect((groupRes.body as GroupDetailResponse).last_shared_at).toEqual(
      expect.any(String),
    );
  });

  it('7. B도 기록을 작성해 공유한다', async () => {
    const recordRes = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', `Bearer ${tokenB}`)
      .field('exerciseType', '요가')
      .field('durationSec', '1200')
      .attach('startFile', TEST_IMAGE_PATH)
      .attach('endFile', TEST_IMAGE_PATH)
      .expect(201);
    const recordIdB = (recordRes.body as RecordResponse).id;

    await request(app.getHttpServer())
      .post('/shares')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ recordId: recordIdB, groupId })
      .expect(201);
  });

  it('8. A가 GET /groups/:id/feed 하면 잠금이 풀리고 본인 기록이 보인다', async () => {
    const res = await request(app.getHttpServer())
      .get(`/groups/${groupId}/feed`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const body = res.body as FeedResponse;
    expect(body.locked).toBe(false);
    expect(body.records).toHaveLength(2);
    expect(body.records.map((record) => record.author.id)).toContain(userAId);
    expect(body.records.map((record) => record.durationSec).sort()).toEqual([
      1200, 1800,
    ]);
    for (const record of body.records) {
      expect(record.startImageUrl).toEqual(expect.any(String));
      expect(record.endImageUrl).toEqual(expect.any(String));
    }
  });
});
