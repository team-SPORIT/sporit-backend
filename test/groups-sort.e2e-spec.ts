import 'dotenv/config';
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

const runId = Date.now();
const DUMMY_IMAGE_URL = 'https://example.com/dummy.jpg';

interface IdResponse {
  id: string;
}

interface GroupListItem {
  id: string;
  name: string;
  last_shared_at: string | null;
  memberCount: number;
}

// 내 그룹 목록 정렬: 최근 공유순(last_shared_at 내림차순), 공유가 없는 그룹은 맨 뒤, 같으면 참여 순
describe('내 그룹 목록 최근 공유순 정렬 (e2e)', () => {
  let app: INestApplication<App>;

  const user = {
    email: `sporit-e2e-sort-${runId}@example.com`,
    password: 'Test1234!',
  };
  let userId: string;
  let token: string;

  // 목록 순서를 비교하기 쉽도록 g1, g2, g3 순서로 생성(= 참여 순)
  const groupIds: string[] = [];
  let recordId1: string;
  let recordId2: string;
  const shareIds: Record<string, string> = {};

  const server = () => app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${token}` });

  async function listGroups(): Promise<GroupListItem[]> {
    const res = await request(server()).get('/groups').set(auth()).expect(200);
    return res.body as GroupListItem[];
  }

  async function listOrder(): Promise<string[]> {
    return (await listGroups()).map((group) => group.id);
  }

  async function share(recordId: string, groupId: string): Promise<string> {
    const res = await request(server())
      .post('/shares')
      .set(auth())
      .send({ recordId, groupId })
      .expect(201);
    return (res.body as IdResponse).id;
  }

  beforeAll(async () => {
    app = await createTestApp();

    userId = (await createTestUser(user.email, user.password)).id;
    token = await getAccessToken(user.email, user.password);
    await request(server()).post('/auth/sync').set(auth());

    for (const index of [1, 2, 3]) {
      const res = await request(server())
        .post('/groups')
        .set(auth())
        .send({ name: `E2E 정렬 그룹 ${index} ${runId}` })
        .expect(201);
      groupIds.push((res.body as IdResponse).id);
    }

    // Storage 업로드 없이 prisma로 기록을 직접 만든다
    const recordDate = new Date();
    recordDate.setUTCHours(0, 0, 0, 0);
    const [record1, record2] = await Promise.all(
      [0, 1].map(() =>
        prisma.records.create({
          data: {
            user_id: userId,
            exercise_type: '러닝',
            start_image_url: DUMMY_IMAGE_URL,
            end_image_url: DUMMY_IMAGE_URL,
            record_date: recordDate,
          },
        }),
      ),
    );
    recordId1 = record1.id.toString();
    recordId2 = record2.id.toString();
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestData({
      userIds: [userId],
      groupIds: groupIds.map((id) => BigInt(id)),
    });
    await disconnectPrisma();
  });

  it('1. 공유가 없는 그룹은 lastSharedAt이 null이고, 참여 순으로 나열된다', async () => {
    const groups = await listGroups();

    expect(groups.map((group) => group.id)).toEqual(groupIds);
    expect(groups.every((group) => group.last_shared_at === null)).toBe(true);
    expect(groups.every((group) => group.memberCount === 1)).toBe(true);
  });

  it('2. 그룹 1, 2에 순서대로 공유하면 목록 순서는 2, 1, 3이고 공유 없는 그룹 3은 맨 뒤이다', async () => {
    const [g1, g2, g3] = groupIds;
    shareIds.g1First = await share(recordId1, g1);
    shareIds.g2First = await share(recordId1, g2);

    const groups = await listGroups();
    expect(groups.map((group) => group.id)).toEqual([g2, g1, g3]);
    expect(groups[0].last_shared_at).toEqual(expect.any(String));
    expect(groups[1].last_shared_at).toEqual(expect.any(String));
    expect(groups[2].last_shared_at).toBeNull();
    // 최신 공유가 더 최근 시각이어야 한다
    expect(new Date(groups[0].last_shared_at!).getTime()).toBeGreaterThan(
      new Date(groups[1].last_shared_at!).getTime(),
    );
  });

  it('3. 그룹 1에 다시 공유하면 그룹 1이 맨 위로 올라온다', async () => {
    const [g1, g2, g3] = groupIds;
    shareIds.g1Second = await share(recordId2, g1);

    expect(await listOrder()).toEqual([g1, g2, g3]);
  });

  it('4. 가장 최근 공유를 취소하면 이전 공유 시각으로 복귀한다', async () => {
    const [g1, g2, g3] = groupIds;
    const before = (await listGroups()).find((group) => group.id === g1)!;

    await request(server())
      .delete(`/shares/${shareIds.g1Second}`)
      .set(auth())
      .expect(204);

    const after = await listGroups();
    // 그룹 1의 이전 공유(그룹 2보다 먼저 한 공유)로 돌아가므로 순서는 2, 1, 3
    expect(after.map((group) => group.id)).toEqual([g2, g1, g3]);

    const restored = after.find((group) => group.id === g1)!;
    expect(new Date(restored.last_shared_at!).getTime()).toBeLessThan(
      new Date(before.last_shared_at!).getTime(),
    );
    const firstShare = await prisma.record_shares.findUnique({
      where: { id: BigInt(shareIds.g1First) },
    });
    expect(restored.last_shared_at).toBe(firstShare!.shared_at.toISOString());
  });

  it('5. 그룹의 마지막 공유를 모두 취소하면 lastSharedAt이 null이 되어 맨 뒤로 간다', async () => {
    const [g1, g2, g3] = groupIds;

    await request(server())
      .delete(`/shares/${shareIds.g2First}`)
      .set(auth())
      .expect(204);

    const groups = await listGroups();
    // 공유가 남은 그룹 1이 맨 위, 공유 없는 그룹 2, 3은 참여 순
    expect(groups.map((group) => group.id)).toEqual([g1, g2, g3]);
    expect(groups.find((group) => group.id === g2)!.last_shared_at).toBeNull();
  });

  it('6. 그룹 상세 조회에도 last_shared_at이 포함된다', async () => {
    const [g1, g2] = groupIds;

    const detail1 = await request(server())
      .get(`/groups/${g1}`)
      .set(auth())
      .expect(200);
    expect((detail1.body as GroupListItem).last_shared_at).toEqual(
      expect.any(String),
    );

    const detail2 = await request(server())
      .get(`/groups/${g2}`)
      .set(auth())
      .expect(200);
    expect((detail2.body as GroupListItem).last_shared_at).toBeNull();
  });
});
