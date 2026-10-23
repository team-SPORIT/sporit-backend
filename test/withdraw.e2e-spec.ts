import 'dotenv/config';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
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
const DUMMY_IMAGE_URL = 'https://example.com/dummy.jpg';
const DAY_MS = 24 * 60 * 60 * 1000;

interface IdResponse {
  id: string;
  invite_code: string;
}

// Storage 확인용 service_role 클라이언트 (테스트 전용)
const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type TestUser = { email: string; id: string; token: string };

// 회원 탈퇴: 그룹장 위임/삭제, 전용 종목 참조 기록 이관, Storage 정리, 다른 유저 데이터 보존
describe('회원 탈퇴 (e2e)', () => {
  let app: INestApplication<App>;

  const password = 'Test1234!';
  const names = ['a', 'm', 'b', 'o2', 'x', 'y', 's', 't', 'u', 'w'] as const;
  const users = Object.fromEntries(
    names.map((name) => [
      name,
      {
        email: `sporit-e2e-wd-${name}-${runId}@example.com`,
        id: '',
        token: '',
      } as TestUser,
    ]),
  ) as Record<(typeof names)[number], TestUser>;
  const groupIds: string[] = [];

  const server = () => app.getHttpServer();
  const authOf = (user: TestUser) => ({
    Authorization: `Bearer ${user.token}`,
  });

  const createGroup = async (owner: TestUser, body: object = {}) => {
    const res = await request(server())
      .post('/groups')
      .set(authOf(owner))
      .send({ name: `E2E 탈퇴 그룹 ${groupIds.length} ${runId}`, ...body })
      .expect(201);
    const group = res.body as IdResponse;
    groupIds.push(group.id);
    return group;
  };

  const join = (user: TestUser, inviteCode: string) =>
    request(server())
      .post('/groups/join')
      .set(authOf(user))
      .send({ code: inviteCode })
      .expect(201);

  const createExercise = async (user: TestUser, name: string) =>
    (
      await prisma.exercises.create({
        data: { owner_id: user.id, name },
      })
    ).id;

  // Storage 업로드 없이 prisma로 기록을 만든다
  const createRecord = async (
    user: TestUser,
    exerciseId: bigint,
    durationSec: number | null = null,
  ) => {
    const record = await prisma.records.create({
      data: {
        user_id: user.id,
        exercise_id: exerciseId,
        duration_sec: durationSec,
        start_image_url: DUMMY_IMAGE_URL,
        end_image_url: DUMMY_IMAGE_URL,
        record_date: new Date(Date.now() - (Date.now() % DAY_MS)),
      },
    });
    return record.id.toString();
  };

  const share = async (user: TestUser, recordId: string, groupId: string) =>
    (
      await request(server())
        .post('/shares')
        .set(authOf(user))
        .send({ recordId, groupId })
        .expect(201)
    ).body as IdResponse;

  const comment = async (user: TestUser, shareId: string, content: string) =>
    (
      await request(server())
        .post(`/shares/${shareId}/comments`)
        .set(authOf(user))
        .send({ content })
        .expect(201)
    ).body as IdResponse;

  const withdraw = (user: TestUser) =>
    request(server()).delete('/profiles/me').set(authOf(user));

  const authUserExists = async (userId: string) => {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    return !error && !!data.user;
  };

  const listFiles = async (bucket: string, folder: string) => {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(folder, { limit: 100 });
    if (error) throw error;
    return data.filter((item) => item.id);
  };

  beforeAll(async () => {
    app = await createTestApp();

    for (const user of Object.values(users)) {
      user.id = (await createTestUser(user.email, password)).id;
      user.token = await getAccessToken(user.email, password);
      await request(server()).post('/auth/sync').set(authOf(user));
    }
  });

  afterAll(async () => {
    await app.close();
    // 탈퇴로 이미 삭제된 유저가 있어도 cleanup은 에러 없이 넘어간다
    await cleanupTestData({
      userIds: Object.values(users).map((user) => user.id),
      groupIds: groupIds.map((id) => BigInt(id)),
    });
    await disconnectPrisma();
  });

  it('1. 일반 멤버가 탈퇴하면 204이고 그 유저의 데이터만 삭제되며 다른 멤버의 데이터는 그대로이다', async () => {
    const { a, m, b } = users;
    const group = await createGroup(a);
    await join(m, group.invite_code);
    await join(b, group.invite_code);

    // A, B의 데이터
    const exA = await createExercise(a, '러닝');
    const exB = await createExercise(b, '러닝');
    const shareA = await share(a, await createRecord(a, exA, 600), group.id);
    const recordB = await createRecord(b, exB, 300);
    const shareB = await share(b, recordB, group.id);
    const commentB = await comment(b, shareA.id, 'B의 댓글');

    // M의 데이터: 개인 종목, 기록(+공유), 통계, 댓글, 좋아요, 카테고리와 매핑
    const exM = await createExercise(m, '요가');
    const recordM = await createRecord(m, exM, 1200);
    const shareM = await share(m, recordM, group.id);
    const commentM = await comment(m, shareA.id, 'M의 댓글');
    await request(server())
      .put(`/shares/${shareA.id}/reaction`)
      .set(authOf(m))
      .expect(204);
    await prisma.user_exercise_stats.create({
      data: {
        user_id: m.id,
        exercise_id: exM,
        total_seconds: 1200,
        total_count: 1,
      },
    });
    const categoryRes = await request(server())
      .post('/categories')
      .set(authOf(m))
      .send({ name: 'M 카테고리', color: 'blue', exerciseNames: ['요가'] })
      .expect(201);
    const categoryM = (categoryRes.body as IdResponse).id;

    await withdraw(m).expect(204);

    // M의 계정과 데이터가 모두 삭제됨
    expect(await authUserExists(m.id)).toBe(false);
    expect(
      await prisma.profiles.findUnique({ where: { id: m.id } }),
    ).toBeNull();
    expect(await prisma.records.count({ where: { user_id: m.id } })).toBe(0);
    expect(
      await prisma.record_shares.findUnique({
        where: { id: BigInt(shareM.id) },
      }),
    ).toBeNull();
    expect(
      await prisma.record_comments.findUnique({
        where: { id: BigInt(commentM.id) },
      }),
    ).toBeNull();
    expect(
      await prisma.record_reactions.count({ where: { user_id: m.id } }),
    ).toBe(0);
    expect(
      await prisma.exercise_categories.findUnique({
        where: { id: BigInt(categoryM) },
      }),
    ).toBeNull();
    expect(
      await prisma.exercise_category_map.count({ where: { user_id: m.id } }),
    ).toBe(0);
    expect(
      await prisma.user_exercise_stats.count({ where: { user_id: m.id } }),
    ).toBe(0);
    expect(await prisma.exercises.count({ where: { owner_id: m.id } })).toBe(0);
    expect(await prisma.group_members.count({ where: { user_id: m.id } })).toBe(
      0,
    );

    // 다른 유저(A, B)의 데이터와 그룹은 그대로
    expect(await authUserExists(a.id)).toBe(true);
    expect(await authUserExists(b.id)).toBe(true);
    const groupRow = await prisma.groups.findUniqueOrThrow({
      where: { id: BigInt(group.id) },
    });
    expect(groupRow.owner_id).toBe(a.id);
    expect(
      await prisma.group_members.count({
        where: { group_id: BigInt(group.id) },
      }),
    ).toBe(2);
    expect(
      await prisma.record_shares.findUnique({
        where: { id: BigInt(shareA.id) },
      }),
    ).not.toBeNull();
    expect(
      await prisma.record_shares.findUnique({
        where: { id: BigInt(shareB.id) },
      }),
    ).not.toBeNull();
    expect(
      await prisma.record_comments.findUnique({
        where: { id: BigInt(commentB.id) },
      }),
    ).not.toBeNull();
    expect(
      await prisma.records.findUnique({ where: { id: BigInt(recordB) } }),
    ).not.toBeNull();
  });

  it('2. 그룹장이 탈퇴하면(다른 멤버 있음) 가장 먼저 가입한 멤버가 그룹장이 되고 그룹과 다른 멤버의 데이터는 유지된다', async () => {
    const { o2, x, y } = users;
    const group = await createGroup(o2);
    await join(y, group.invite_code);
    await join(x, group.invite_code);
    // 가입 순서: x(가장 먼저) -> y -> o2
    const groupId = BigInt(group.id);
    await prisma.group_members.update({
      where: { group_id_user_id: { group_id: groupId, user_id: x.id } },
      data: { joined_at: new Date(Date.now() - 3 * DAY_MS) },
    });
    await prisma.group_members.update({
      where: { group_id_user_id: { group_id: groupId, user_id: y.id } },
      data: { joined_at: new Date(Date.now() - 2 * DAY_MS) },
    });

    const exO = await createExercise(o2, '러닝');
    const exX = await createExercise(x, '러닝');
    const exY = await createExercise(y, '러닝');
    const shareO = await share(o2, await createRecord(o2, exO, 100), group.id);
    const shareX = await share(x, await createRecord(x, exX, 200), group.id);
    const shareY = await share(y, await createRecord(y, exY, 300), group.id);
    const commentX = await comment(x, shareO.id, 'X의 댓글');
    const commentY = await comment(y, shareX.id, 'Y의 댓글');

    await withdraw(o2).expect(204);

    expect(await authUserExists(o2.id)).toBe(false);
    const groupRow = await prisma.groups.findUniqueOrThrow({
      where: { id: groupId },
    });
    expect(groupRow.owner_id).toBe(x.id); // 가장 먼저 가입한 멤버에게 위임
    expect(
      (await prisma.group_members.findMany({ where: { group_id: groupId } }))
        .map((member) => member.user_id)
        .sort(),
    ).toEqual([x.id, y.id].sort());

    // 다른 멤버의 공유/댓글은 유지, 탈퇴한 그룹장의 공유(와 그 위의 댓글)만 삭제
    expect(
      await prisma.record_shares.findUnique({
        where: { id: BigInt(shareX.id) },
      }),
    ).not.toBeNull();
    expect(
      await prisma.record_shares.findUnique({
        where: { id: BigInt(shareY.id) },
      }),
    ).not.toBeNull();
    expect(
      await prisma.record_comments.findUnique({
        where: { id: BigInt(commentY.id) },
      }),
    ).not.toBeNull();
    expect(
      await prisma.record_shares.findUnique({
        where: { id: BigInt(shareO.id) },
      }),
    ).toBeNull();
    expect(
      await prisma.record_comments.findUnique({
        where: { id: BigInt(commentX.id) },
      }),
    ).toBeNull(); // 탈퇴한 사람의 공유 위에 달린 댓글은 공유와 함께 삭제됨

    // 새 그룹장이 실제로 그룹장 권한을 가진다
    await request(server())
      .patch(`/groups/${group.id}`)
      .set(authOf(x))
      .send({ color: 'sky' })
      .expect(200);
  });

  it('3. 그룹장이 혼자뿐인 상태로 탈퇴하면 그룹이 삭제된다', async () => {
    const { s } = users;
    const group = await createGroup(s);
    const exS = await createExercise(s, '러닝');
    await share(s, await createRecord(s, exS, 100), group.id);

    await withdraw(s).expect(204);

    expect(await authUserExists(s.id)).toBe(false);
    expect(
      await prisma.groups.findUnique({ where: { id: BigInt(group.id) } }),
    ).toBeNull();
    expect(
      await prisma.record_shares.count({
        where: { group_id: BigInt(group.id) },
      }),
    ).toBe(0);
  });

  it('4. 혼자 남은 그룹의 전용 종목을 이전 멤버의 기록이 참조 중이어도 탈퇴가 성공하고 기록은 작성자의 개인 종목으로 이관된다', async () => {
    const { t, u } = users;
    const group = await createGroup(t, {
      allowAll: false,
      names: ['플랭크'],
    });
    const groupId = BigInt(group.id);
    await join(u, group.invite_code);

    const groupExercise = await prisma.exercises.findFirstOrThrow({
      where: { group_id: groupId, name: '플랭크' },
    });

    // U는 이미 같은 이름의 개인 종목과 그 통계를 가지고 있다 (통계 합산 확인용)
    const personalU = await createExercise(u, '플랭크');
    await createRecord(u, personalU, 100);
    await prisma.user_exercise_stats.create({
      data: {
        user_id: u.id,
        exercise_id: personalU,
        total_seconds: 100,
        total_count: 1,
        last_at: new Date('2026-01-01T00:00:00Z'),
      },
    });
    // U가 그룹 전용 종목으로 만든 기록과 통계
    const recordU = await createRecord(u, groupExercise.id, 500);
    await prisma.user_exercise_stats.create({
      data: {
        user_id: u.id,
        exercise_id: groupExercise.id,
        total_seconds: 500,
        total_count: 1,
        last_at: new Date('2026-06-01T00:00:00Z'),
      },
    });
    // T(탈퇴할 그룹장) 본인의 기록도 그룹 전용 종목을 참조한다
    await createRecord(t, groupExercise.id, 50);

    // U가 그룹을 나가서 T 혼자 남는다 (U의 기록은 그대로 남는다)
    await request(server())
      .delete(`/groups/${group.id}/members/me`)
      .set(authOf(u))
      .expect(204);
    expect(
      await prisma.group_members.count({ where: { group_id: groupId } }),
    ).toBe(1);

    await withdraw(t).expect(204);

    // 그룹과 그룹 전용 종목이 삭제됨
    expect(
      await prisma.groups.findUnique({ where: { id: groupId } }),
    ).toBeNull();
    expect(await prisma.exercises.count({ where: { group_id: groupId } })).toBe(
      0,
    );
    expect(await authUserExists(t.id)).toBe(false);

    // U의 기록은 U의 개인 종목 '플랭크'로 이관됨
    const movedRecord = await prisma.records.findUniqueOrThrow({
      where: { id: BigInt(recordU) },
    });
    expect(movedRecord.exercise_id).toBe(personalU);
    expect(movedRecord.user_id).toBe(u.id);

    // 통계는 합산되고(100+500, 1+1) last_at은 더 최근 값, 그룹 전용 종목의 통계는 사라짐
    const stats = await prisma.user_exercise_stats.findMany({
      where: { user_id: u.id },
    });
    expect(stats).toHaveLength(1);
    expect(stats[0].exercise_id).toBe(personalU);
    expect(stats[0].total_seconds).toBe(600);
    expect(stats[0].total_count).toBe(2);
    expect(stats[0].last_at!.toISOString()).toBe('2026-06-01T00:00:00.000Z');

    // U의 계정과 개인 종목은 영향 없음
    expect(await authUserExists(u.id)).toBe(true);
    expect(await prisma.exercises.count({ where: { owner_id: u.id } })).toBe(1);
  });

  it('5. 탈퇴 후 프로필/기록 사진이 Storage에서 삭제된다', async () => {
    const { w } = users;
    const exW = await request(server())
      .post('/exercises')
      .set(authOf(w))
      .send({ name: '러닝' })
      .expect(201);

    await request(server())
      .post('/profiles/me/avatar')
      .set(authOf(w))
      .attach('file', TEST_IMAGE_PATH)
      .expect(201);
    await request(server())
      .post('/records')
      .set(authOf(w))
      .field('exerciseId', (exW.body as IdResponse).id)
      .attach('startFile', TEST_IMAGE_PATH)
      .attach('endFile', TEST_IMAGE_PATH)
      .expect(201);

    // 탈퇴 전에는 파일이 있다
    expect((await listFiles('profile-images', w.id)).length).toBe(1);
    expect((await listFiles('record-images', `records/${w.id}`)).length).toBe(
      2,
    );

    await withdraw(w).expect(204);

    expect(await listFiles('profile-images', w.id)).toEqual([]);
    expect(await listFiles('record-images', `records/${w.id}`)).toEqual([]);
    expect(await authUserExists(w.id)).toBe(false);
  });

  it('6. 탈퇴한 유저의 토큰으로 요청하면 정상 동작하지 않고, 탈퇴를 다시 요청해도 204이다(멱등)', async () => {
    const { w } = users; // 5번에서 탈퇴함

    // 토큰(JWT) 자체는 만료 전까지 서명이 유효하지만 프로필이 없어 정상 응답하지 않는다
    await request(server()).get('/profiles/me').set(authOf(w)).expect(404);

    // 이미 삭제된 계정으로 다시 탈퇴를 요청해도 에러 없이 성공 처리
    await withdraw(w).expect(204);
  });

  it('7. 토큰이 없으면 401이다', async () => {
    await request(server()).delete('/profiles/me').expect(401);
  });
});
