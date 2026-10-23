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
  invite_code: string;
}

interface ExerciseSummary {
  id: string;
  name: string;
  isDefault: boolean;
}

interface GroupExercisesResponse {
  restricted: boolean;
  exercises: ExerciseSummary[];
}

interface SelectableResponse {
  mine: ExerciseSummary[];
  groups: {
    groupId: string;
    groupName: string;
    exercises: ExerciseSummary[];
  }[];
}

interface GroupListItem {
  id: string;
  name: string;
  last_shared_at: string | null;
  memberCount: number;
}

interface FeedResponse {
  locked: boolean;
  records: { recordId: string; exerciseId: string; exerciseType: string }[];
}

// 그룹별 허용 종목: 설정/조회 권한, 선택 목록, 종목별 공유 가능 그룹, 공유 시 허용 종목 검증
describe('그룹 허용 종목 (e2e)', () => {
  let app: INestApplication<App>;

  const users = {
    a: { email: `sporit-e2e-ge-a-${runId}@example.com`, id: '', token: '' },
    b: { email: `sporit-e2e-ge-b-${runId}@example.com`, id: '', token: '' },
    c: { email: `sporit-e2e-ge-c-${runId}@example.com`, id: '', token: '' },
  };
  const password = 'Test1234!';

  // 기본 종목 id (러닝, 요가, 수영)
  const ex: Record<'running' | 'yoga' | 'swimming', string> = {
    running: '',
    yoga: '',
    swimming: '',
  };
  let customId: string; // A의 개인 종목
  const groupIds: string[] = []; // [g1, g2, g3]
  let runningRecordId: string;
  let swimmingRecordId: string;

  const server = () => app.getHttpServer();
  const authOf = (user: { token: string }) => ({
    Authorization: `Bearer ${user.token}`,
  });

  const putExercises = (
    user: { token: string },
    groupId: string,
    exerciseIds: unknown,
  ) =>
    request(server())
      .put(`/groups/${groupId}/exercises`)
      .set(authOf(user))
      .send({ exerciseIds });

  beforeAll(async () => {
    app = await createTestApp();

    for (const user of Object.values(users)) {
      user.id = (await createTestUser(user.email, password)).id;
      user.token = await getAccessToken(user.email, password);
      await request(server()).post('/auth/sync').set(authOf(user));
    }

    for (const [key, name] of [
      ['running', '러닝'],
      ['yoga', '요가'],
      ['swimming', '수영'],
    ] as const) {
      const exercise = await prisma.exercises.findFirstOrThrow({
        where: { owner_id: null, name },
      });
      ex[key] = exercise.id.toString();
    }

    // A의 개인 종목
    const customRes = await request(server())
      .post('/exercises')
      .set(authOf(users.a))
      .send({ name: `E2E 그룹종목 개인 ${runId}` })
      .expect(201);
    customId = (customRes.body as IdResponse).id;

    // 그룹 3개: A가 모두 그룹장, B는 g1/g2 멤버, C는 어디에도 없음
    for (const index of [1, 2, 3]) {
      const res = await request(server())
        .post('/groups')
        .set(authOf(users.a))
        .send({ name: `E2E 허용종목 그룹 ${index} ${runId}` })
        .expect(201);
      groupIds.push((res.body as IdResponse).id);
      if (index !== 3) {
        await request(server())
          .post('/groups/join')
          .set(authOf(users.b))
          .send({ code: (res.body as IdResponse).invite_code })
          .expect(201);
      }
    }

    // Storage 업로드 없이 prisma로 기록을 직접 만든다
    const recordDate = new Date();
    recordDate.setUTCHours(0, 0, 0, 0);
    const [runningRecord, swimmingRecord] = await Promise.all(
      [ex.running, ex.swimming].map((exerciseId) =>
        prisma.records.create({
          data: {
            user_id: users.a.id,
            exercise_id: BigInt(exerciseId),
            start_image_url: DUMMY_IMAGE_URL,
            end_image_url: DUMMY_IMAGE_URL,
            record_date: recordDate,
          },
        }),
      ),
    );
    runningRecordId = runningRecord.id.toString();
    swimmingRecordId = swimmingRecord.id.toString();
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestData({
      userIds: Object.values(users).map((user) => user.id),
      groupIds: groupIds.map((id) => BigInt(id)),
    });
    await disconnectPrisma();
  });

  it('1. 그룹장이 PUT으로 허용 종목(기본 종목 2개, 중복 포함)을 설정하면 GET에서 restricted=true와 목록이 일치한다', async () => {
    const [g1] = groupIds;

    const putRes = await putExercises(users.a, g1, [
      ex.yoga,
      ex.running,
      ex.running,
    ]).expect(200);
    const expected: GroupExercisesResponse = {
      restricted: true,
      exercises: [
        { id: ex.running, name: '러닝', isDefault: true },
        { id: ex.yoga, name: '요가', isDefault: true },
      ],
    };
    expect(putRes.body).toEqual(expected);

    // 그룹 멤버(B)도 조회할 수 있다
    for (const user of [users.a, users.b]) {
      const getRes = await request(server())
        .get(`/groups/${g1}/exercises`)
        .set(authOf(user))
        .expect(200);
      expect(getRes.body).toEqual(expected);
    }
  });

  it('2. 허용 종목을 1개로 바꾸면 GET에 반영되고, 빈 배열이면 restricted=false가 된다', async () => {
    const [g1] = groupIds;

    await putExercises(users.a, g1, [ex.running]).expect(200);
    const one = await request(server())
      .get(`/groups/${g1}/exercises`)
      .set(authOf(users.a))
      .expect(200);
    expect(one.body).toEqual({
      restricted: true,
      exercises: [{ id: ex.running, name: '러닝', isDefault: true }],
    });

    const emptyRes = await putExercises(users.a, g1, []).expect(200);
    expect(emptyRes.body).toEqual({ restricted: false, exercises: [] });
    const empty = await request(server())
      .get(`/groups/${g1}/exercises`)
      .set(authOf(users.a))
      .expect(200);
    expect(empty.body).toEqual({ restricted: false, exercises: [] });

    // 이후 테스트를 위한 설정: g1은 러닝+요가, g2는 수영만 허용, g3는 제한 없음
    await putExercises(users.a, g1, [ex.running, ex.yoga]).expect(200);
    await putExercises(users.a, groupIds[1], [ex.swimming]).expect(200);
  });

  it('3. 그룹장이 아닌 멤버의 PUT은 403, 비멤버의 GET/PUT도 403이다', async () => {
    const [g1] = groupIds;

    await putExercises(users.b, g1, [ex.running]).expect(403);
    await request(server())
      .get(`/groups/${g1}/exercises`)
      .set(authOf(users.c))
      .expect(403);
    await putExercises(users.c, g1, [ex.running]).expect(403);

    // 거부된 요청은 설정을 바꾸지 않는다
    const res = await request(server())
      .get(`/groups/${g1}/exercises`)
      .set(authOf(users.a))
      .expect(200);
    expect((res.body as GroupExercisesResponse).exercises).toHaveLength(2);
  });

  it('4. 개인 종목이나 존재하지 않는 종목 ID를 넣으면 400이고 설정은 바뀌지 않는다', async () => {
    const [g1] = groupIds;

    await putExercises(users.a, g1, [ex.running, customId]).expect(400);
    await putExercises(users.a, g1, [ex.running, '999999999']).expect(400);

    // DTO 검증: 배열이 아님, 숫자 문자열이 아님, 50개 초과
    await putExercises(users.a, g1, ex.running).expect(400);
    await putExercises(users.a, g1, ['abc']).expect(400);
    await putExercises(
      users.a,
      g1,
      Array.from({ length: 51 }, () => ex.running),
    ).expect(400);

    const res = await request(server())
      .get(`/groups/${g1}/exercises`)
      .set(authOf(users.a))
      .expect(200);
    expect(
      (res.body as GroupExercisesResponse).exercises.map((e) => e.id),
    ).toEqual([ex.running, ex.yoga]);
  });

  it('5. GET /exercises/selectable: 내 개인 종목은 mine, 제한 그룹의 허용 종목은 groups에 나오고 제한 없는 그룹은 없다', async () => {
    const [g1, g2, g3] = groupIds;

    const resA = await request(server())
      .get('/exercises/selectable')
      .set(authOf(users.a))
      .expect(200);
    const bodyA = resA.body as SelectableResponse;

    expect(bodyA.mine.map((e) => e.id)).toEqual([customId]);
    expect(bodyA.mine.every((e) => e.isDefault === false)).toBe(true);
    // 기본 종목 전체 풀은 mine에 들어가지 않는다
    expect(bodyA.mine.map((e) => e.id)).not.toContain(ex.running);

    const groupsById = new Map(bodyA.groups.map((g) => [g.groupId, g]));
    expect([...groupsById.keys()].sort()).toEqual([g1, g2].sort());
    expect(groupsById.has(g3)).toBe(false);
    expect(groupsById.get(g1)!.exercises.map((e) => e.id)).toEqual([
      ex.running,
      ex.yoga,
    ]);
    expect(groupsById.get(g2)!.exercises).toEqual([
      { id: ex.swimming, name: '수영', isDefault: true },
    ]);

    // B는 개인 종목이 없고, 자신이 속한 제한 그룹(g1, g2)만 나온다
    const resB = await request(server())
      .get('/exercises/selectable')
      .set(authOf(users.b))
      .expect(200);
    const bodyB = resB.body as SelectableResponse;
    expect(bodyB.mine).toEqual([]);
    expect(bodyB.groups.map((g) => g.groupId).sort()).toEqual([g1, g2].sort());
  });

  it('6. GET /exercises/:id/groups: 허용된 그룹과 제한 없는 그룹만 나오고 허용 안 된 그룹은 안 나온다', async () => {
    const [g1, g2, g3] = groupIds;
    const idsFor = async (user: { token: string }, exerciseId: string) => {
      const res = await request(server())
        .get(`/exercises/${exerciseId}/groups`)
        .set(authOf(user))
        .expect(200);
      return (res.body as GroupListItem[]).map((group) => group.id);
    };

    // 러닝: g1(허용) + g3(제한 없음), g2(수영만 허용)는 제외. 정렬은 참여순
    expect(await idsFor(users.a, ex.running)).toEqual([g1, g3]);
    // 수영: g2(허용) + g3, g1은 제외
    expect(await idsFor(users.a, ex.swimming)).toEqual([g2, g3]);
    // 내 개인 종목: 제한 없는 g3만
    expect(await idsFor(users.a, customId)).toEqual([g3]);

    // GET /groups와 같은 응답 형태 (lastSharedAt, memberCount 포함)
    const res = await request(server())
      .get(`/exercises/${ex.running}/groups`)
      .set(authOf(users.a))
      .expect(200);
    const first = (res.body as GroupListItem[])[0];
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('last_shared_at');
    expect(first.memberCount).toBe(2);

    // B가 속하지 않은 g3는 나오지 않는다
    expect(await idsFor(users.b, ex.running)).toEqual([g1]);

    // 남의 개인 종목은 403, 없는 종목은 404
    await request(server())
      .get(`/exercises/${customId}/groups`)
      .set(authOf(users.b))
      .expect(403);
    await request(server())
      .get('/exercises/999999999/groups')
      .set(authOf(users.a))
      .expect(404);
  });

  it('7. POST /shares: 허용되지 않은 종목은 403, 허용 종목과 제한 없는 그룹은 201이다', async () => {
    const [g1, g2, g3] = groupIds;
    const share = (recordId: string, groupId: string) =>
      request(server())
        .post('/shares')
        .set(authOf(users.a))
        .send({ recordId, groupId });

    // g1은 러닝/요가만 허용: 수영 기록은 403
    const denied = await share(swimmingRecordId, g1).expect(403);
    expect((denied.body as { message: string }).message).toBe(
      '이 그룹에서 허용되지 않은 종목입니다.',
    );

    await share(runningRecordId, g1).expect(201); // 허용 종목
    await share(swimmingRecordId, g2).expect(201); // g2는 수영 허용
    await share(swimmingRecordId, g3).expect(201); // g3는 제한 없음

    // 거부된 공유는 저장되지 않는다
    const g1Shares = await prisma.record_shares.count({
      where: { group_id: BigInt(g1), record_id: BigInt(swimmingRecordId) },
    });
    expect(g1Shares).toBe(0);
  });

  it('8. 허용 목록을 나중에 바꿔도 이미 공유된 기록은 피드에 그대로 보인다', async () => {
    const [g1] = groupIds;

    // g1의 러닝 기록은 이미 공유됨. 이제 요가만 허용하도록 변경
    await putExercises(users.a, g1, [ex.yoga]).expect(200);

    const res = await request(server())
      .get(`/groups/${g1}/feed`)
      .set(authOf(users.a))
      .expect(200);
    const body = res.body as FeedResponse;

    expect(body.locked).toBe(false);
    expect(body.records.map((record) => record.recordId)).toEqual([
      runningRecordId,
    ]);
    expect(body.records[0].exerciseType).toBe('러닝');
    expect(body.records[0].exerciseId).toBe(ex.running);
  });
});
