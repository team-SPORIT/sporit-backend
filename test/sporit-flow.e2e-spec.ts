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
// 그룹 가입 당일 제외 정책을 검증하려면 "어제 가입"을 흉내내야 하므로, 실제 시각보다 이틀 전으로 백데이트한다
const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

interface ProfileResponse {
  id: string;
  current_streak: number;
}

interface GroupResponse {
  id: string;
  invite_code: string;
  current_streak: number;
}

interface GroupDetailResponse {
  id: string;
  current_streak: number;
}

interface RecordResponse {
  id: string;
}

interface FeedShare {
  author: { id: string };
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
      userIds: [userAId, userBId],
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

    // 그룹 전체 스트릭의 "가입 당일 제외" 정책 때문에, 오늘 막 가입한 A/B를 기준으로는
    // 전원 공유 판정이 항상 자명하게 참이 되어 부분 공유(0 유지) 케이스를 검증할 수 없다.
    // 두 멤버가 어제 가입한 것처럼 백데이트해 실제 시나리오(기존 멤버)를 재현한다.
    await prisma.group_members.updateMany({
      where: { group_id: BigInt(groupId) },
      data: { joined_at: new Date(Date.now() - TWO_DAYS_MS) },
    });
  });

  it('4. A가 GET /groups/:id/feed 하면 아직 공유 전이라 잠겨 있다', async () => {
    const res = await request(app.getHttpServer())
      .get(`/groups/${groupId}/feed`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect(res.body as FeedResponse).toEqual({ locked: true, records: [] });
  });

  it('5. A가 POST /records(사진 포함)로 기록을 작성하면 개인 스트릭이 1이 된다', async () => {
    const res = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('exerciseType', '러닝')
      .field('durationMin', '30')
      .attach('file', TEST_IMAGE_PATH)
      .expect(201);

    const body = res.body as RecordResponse;
    expect(body.id).toBeDefined();
    recordId = body.id;

    const profileRes = await request(app.getHttpServer())
      .get('/profiles/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect((profileRes.body as ProfileResponse).current_streak).toBe(1);
  });

  it('6. A만 POST /shares로 공유하면 B가 아직 공유 전이라 그룹 스트릭은 0으로 유지된다', async () => {
    await request(app.getHttpServer())
      .post('/shares')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ recordId, groupId })
      .expect(201);

    const groupRes = await request(app.getHttpServer())
      .get(`/groups/${groupId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect((groupRes.body as GroupDetailResponse).current_streak).toBe(0);
  });

  it('7. B도 기록을 작성해 공유하면 전원 공유로 그룹 스트릭이 1이 된다', async () => {
    const recordRes = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', `Bearer ${tokenB}`)
      .field('exerciseType', '요가')
      .field('durationMin', '20')
      .attach('file', TEST_IMAGE_PATH)
      .expect(201);
    const recordIdB = (recordRes.body as RecordResponse).id;

    await request(app.getHttpServer())
      .post('/shares')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ recordId: recordIdB, groupId })
      .expect(201);

    const groupRes = await request(app.getHttpServer())
      .get(`/groups/${groupId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect((groupRes.body as GroupDetailResponse).current_streak).toBe(1);
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
  });
});

// 그룹 전체 스트릭의 "가입 당일 제외" 정책만 별도로 검증: 오늘 막 가입한 멤버는
// 전원 공유 판정의 분모에서 빠지므로, 기존 멤버끼리만 공유해도 그룹 스트릭이 오른다
describe('그룹 전체 스트릭 - 가입 당일 멤버 제외 (e2e)', () => {
  let app: INestApplication<App>;

  const userA = {
    email: `sporit-e2e-exclusion-a-${runId}@example.com`,
    password: 'Test1234!',
  };
  const userB = {
    email: `sporit-e2e-exclusion-b-${runId}@example.com`,
    password: 'Test1234!',
  };
  const userC = {
    email: `sporit-e2e-exclusion-c-${runId}@example.com`,
    password: 'Test1234!',
  };

  let userAId: string;
  let userBId: string;
  let userCId: string;
  let tokenA: string;
  let tokenB: string;
  let tokenC: string;

  let groupId: string;

  beforeAll(async () => {
    app = await createTestApp();

    const createdA = await createTestUser(userA.email, userA.password);
    const createdB = await createTestUser(userB.email, userB.password);
    const createdC = await createTestUser(userC.email, userC.password);
    userAId = createdA.id;
    userBId = createdB.id;
    userCId = createdC.id;

    tokenA = await getAccessToken(userA.email, userA.password);
    tokenB = await getAccessToken(userB.email, userB.password);
    tokenC = await getAccessToken(userC.email, userC.password);

    await request(app.getHttpServer())
      .post('/auth/sync')
      .set('Authorization', `Bearer ${tokenA}`);
    await request(app.getHttpServer())
      .post('/auth/sync')
      .set('Authorization', `Bearer ${tokenB}`);
    await request(app.getHttpServer())
      .post('/auth/sync')
      .set('Authorization', `Bearer ${tokenC}`);
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestData({
      userIds: [userAId, userBId, userCId],
      groupIds: groupId ? [BigInt(groupId)] : [],
    });
    await disconnectPrisma();
  });

  it('오늘 막 가입한 C는 전원 판정에서 제외되어, A/B만 공유해도 그룹 스트릭이 1이 된다', async () => {
    const groupRes = await request(app.getHttpServer())
      .post('/groups')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: `E2E 제외정책 그룹 ${runId}` })
      .expect(201);
    const group = groupRes.body as GroupResponse;
    groupId = group.id;

    await request(app.getHttpServer())
      .post('/groups/join')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ code: group.invite_code })
      .expect(201);

    // A, B는 어제 가입한 기존 멤버로 백데이트, C는 오늘(실제 가입일 그대로) 가입해 분모에서 제외되어야 한다
    await prisma.group_members.updateMany({
      where: {
        group_id: BigInt(groupId),
        user_id: { in: [userAId, userBId] },
      },
      data: { joined_at: new Date(Date.now() - TWO_DAYS_MS) },
    });

    await request(app.getHttpServer())
      .post('/groups/join')
      .set('Authorization', `Bearer ${tokenC}`)
      .send({ code: group.invite_code })
      .expect(201);

    const recordA = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', `Bearer ${tokenA}`)
      .field('exerciseType', '러닝')
      .attach('file', TEST_IMAGE_PATH)
      .expect(201);
    await request(app.getHttpServer())
      .post('/shares')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ recordId: (recordA.body as RecordResponse).id, groupId })
      .expect(201);

    const recordB = await request(app.getHttpServer())
      .post('/records')
      .set('Authorization', `Bearer ${tokenB}`)
      .field('exerciseType', '요가')
      .attach('file', TEST_IMAGE_PATH)
      .expect(201);
    await request(app.getHttpServer())
      .post('/shares')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ recordId: (recordB.body as RecordResponse).id, groupId })
      .expect(201);

    // C는 끝까지 공유하지 않는다

    const finalGroupRes = await request(app.getHttpServer())
      .get(`/groups/${groupId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect((finalGroupRes.body as GroupDetailResponse).current_streak).toBe(1);
  });
});
