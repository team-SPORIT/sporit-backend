import 'dotenv/config';
import path from 'path';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/app.helper';
import { createTestUser, getAccessToken } from './helpers/auth.helper';
import { cleanupTestData, disconnectPrisma } from './helpers/cleanup.helper';

const TEST_IMAGE_PATH = path.join(__dirname, 'fixtures', 'test-image.png');
const runId = Date.now();

interface ProfileResponse {
  id: string;
  current_streak: number;
}

interface GroupResponse {
  id: string;
  invite_code: string;
}

interface GroupMember {
  user_id: string;
  current_streak: number;
}

interface GroupDetailResponse {
  id: string;
  group_members: GroupMember[];
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
      .field('calories', '250')
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

  it('6. A가 POST /shares로 기록을 그룹에 공유하면 그룹 스트릭이 1이 된다', async () => {
    await request(app.getHttpServer())
      .post('/shares')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ recordId, groupId })
      .expect(201);

    const groupRes = await request(app.getHttpServer())
      .get(`/groups/${groupId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const memberA = (groupRes.body as GroupDetailResponse).group_members.find(
      (member) => member.user_id === userAId,
    );

    expect(memberA?.current_streak).toBe(1);
  });

  it('7. A가 GET /groups/:id/feed 하면 잠금이 풀리고 본인 기록이 보인다', async () => {
    const res = await request(app.getHttpServer())
      .get(`/groups/${groupId}/feed`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const body = res.body as FeedResponse;
    expect(body.locked).toBe(false);
    expect(body.records).toHaveLength(1);
    expect(body.records[0].author.id).toBe(userAId);
  });

  it('8. B가 GET /groups/:id/feed 하면 본인은 아직 공유 전이라 잠겨 있다', async () => {
    const res = await request(app.getHttpServer())
      .get(`/groups/${groupId}/feed`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(res.body as FeedResponse).toEqual({ locked: true, records: [] });
  });
});
