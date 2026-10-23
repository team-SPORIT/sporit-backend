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
const DUMMY_IMAGE_URL = 'https://example.com/dummy.jpg';

interface IdResponse {
  id: string;
  invite_code: string;
}

interface ExerciseSummary {
  id: string;
  name: string;
}

interface GroupExercisesResponse {
  allowAll: boolean;
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

interface RecordResponse {
  id: string;
  exercise_id: string;
  exercise_type: string;
}

interface FeedResponse {
  locked: boolean;
  records: { recordId: string; exerciseId: string; exerciseType: string }[];
}

interface WeeklyStats {
  byExercise: { exerciseType: string; totalSeconds: number; count: number }[];
}

// 그룹별 허용 종목(이름 기준): 기본 종목 없이 개인 종목 + 그룹 전용 종목으로 동작한다
describe('그룹 허용 종목 (e2e)', () => {
  let app: INestApplication<App>;

  const users = {
    a: { email: `sporit-e2e-ge-a-${runId}@example.com`, id: '', token: '' },
    b: { email: `sporit-e2e-ge-b-${runId}@example.com`, id: '', token: '' },
    c: { email: `sporit-e2e-ge-c-${runId}@example.com`, id: '', token: '' },
  };
  const password = 'Test1234!';

  // A의 개인 종목, B의 개인 종목
  let runningA: string;
  let swimmingA: string;
  let runningB: string;
  const groupIds: string[] = []; // [g1, g2, g3] A가 모두 그룹장, B는 g1/g2 멤버
  // g1의 그룹 전용 종목 id
  let groupRunning1: string;
  let groupYoga1: string;
  let recordRunningA: string;
  let recordSwimmingA: string;

  const server = () => app.getHttpServer();
  const authOf = (user: { token: string }) => ({
    Authorization: `Bearer ${user.token}`,
  });

  const putExercises = (
    user: { token: string },
    groupId: string,
    body: unknown,
  ) =>
    request(server())
      .put(`/groups/${groupId}/exercises`)
      .set(authOf(user))
      .send(body as object);

  const createExercise = async (user: { token: string }, name: string) => {
    const res = await request(server())
      .post('/exercises')
      .set(authOf(user))
      .send({ name })
      .expect(201);
    return (res.body as IdResponse).id;
  };

  const createRecordRow = async (
    userId: string,
    exerciseId: string,
  ): Promise<string> => {
    const recordDate = new Date();
    recordDate.setUTCHours(0, 0, 0, 0);
    const record = await prisma.records.create({
      data: {
        user_id: userId,
        exercise_id: BigInt(exerciseId),
        start_image_url: DUMMY_IMAGE_URL,
        end_image_url: DUMMY_IMAGE_URL,
        record_date: recordDate,
      },
    });
    return record.id.toString();
  };

  const share = (user: { token: string }, recordId: string, groupId: string) =>
    request(server())
      .post('/shares')
      .set(authOf(user))
      .send({ recordId, groupId });

  const groupsForExercise = async (
    user: { token: string },
    exerciseId: string,
  ) => {
    const res = await request(server())
      .get(`/exercises/${exerciseId}/groups`)
      .set(authOf(user))
      .expect(200);
    return (res.body as GroupListItem[]).map((group) => group.id);
  };

  beforeAll(async () => {
    app = await createTestApp();

    for (const user of Object.values(users)) {
      user.id = (await createTestUser(user.email, password)).id;
      user.token = await getAccessToken(user.email, password);
      await request(server()).post('/auth/sync').set(authOf(user));
    }

    runningA = await createExercise(users.a, '러닝');
    swimmingA = await createExercise(users.a, '수영');
    runningB = await createExercise(users.b, '러닝');

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

    // Storage 업로드 없이 prisma로 기록을 직접 만든다 (공유 테스트용)
    recordRunningA = await createRecordRow(users.a.id, runningA);
    recordSwimmingA = await createRecordRow(users.a.id, swimmingA);
  });

  afterAll(async () => {
    await app.close();
    // cleanup이 기록(작성자 B 포함)을 먼저 지우고, 그다음 그룹(그룹 전용 종목 cascade)과 유저를 지운다
    await cleanupTestData({
      userIds: Object.values(users).map((user) => user.id),
      groupIds: groupIds.map((id) => BigInt(id)),
    });
    await disconnectPrisma();
  });

  it('1. 새 그룹은 모든 종목 허용(allowAll=true)이고 허용 목록은 비어 있다', async () => {
    const res = await request(server())
      .get(`/groups/${groupIds[0]}/exercises`)
      .set(authOf(users.a))
      .expect(200);

    expect(res.body).toEqual({ allowAll: true, exercises: [] });
  });

  it('2. allowAll=false와 names로 설정하면 그룹 전용 종목이 만들어지고 이름은 공백 정리 후 중복이 제거된다', async () => {
    const [g1] = groupIds;

    const res = await putExercises(users.a, g1, {
      allowAll: false,
      names: ['  러닝  ', '러닝', '요가', '플랭크   운동'],
    }).expect(200);
    const body = res.body as GroupExercisesResponse;

    expect(body.allowAll).toBe(false);
    expect(body.exercises.map((exercise) => exercise.name)).toEqual([
      '러닝',
      '요가',
      '플랭크 운동',
    ]);
    groupRunning1 = body.exercises[0].id;
    groupYoga1 = body.exercises[1].id;

    // 그룹 전용 종목은 group_id를 가지고 owner_id는 없다 (개인 종목과 구분)
    const row = await prisma.exercises.findUniqueOrThrow({
      where: { id: BigInt(groupRunning1) },
    });
    expect(row.group_id).toBe(BigInt(g1));
    expect(row.owner_id).toBeNull();

    // 멤버(B)도 같은 목록을 조회한다
    const getRes = await request(server())
      .get(`/groups/${g1}/exercises`)
      .set(authOf(users.b))
      .expect(200);
    expect(getRes.body).toEqual(body);
  });

  it('3. 같은 이름은 그룹 전용 종목을 재사용하고, 목록에서 빠진 종목 행은 삭제하지 않는다', async () => {
    const [g1] = groupIds;

    const res = await putExercises(users.a, g1, {
      allowAll: false,
      names: ['러닝'],
    }).expect(200);
    const body = res.body as GroupExercisesResponse;

    expect(body.exercises).toEqual([{ id: groupRunning1, name: '러닝' }]);

    const groupExerciseCount = await prisma.exercises.count({
      where: { group_id: BigInt(g1) },
    });
    expect(groupExerciseCount).toBe(3); // 러닝, 요가, 플랭크 운동 행이 모두 남아 있다

    // 다음 테스트를 위한 설정: g1은 러닝+요가
    await putExercises(users.a, g1, {
      allowAll: false,
      names: ['러닝', '요가'],
    }).expect(200);
  });

  it('4. allowAll=true로 바꾸면 허용 목록은 그대로 보관되고, false인데 names가 없거나 비면 400이다', async () => {
    const [g1] = groupIds;

    const onRes = await putExercises(users.a, g1, { allowAll: true }).expect(
      200,
    );
    const on = onRes.body as GroupExercisesResponse;
    expect(on.allowAll).toBe(true);
    expect(on.exercises.map((exercise) => exercise.id)).toEqual([
      groupRunning1,
      groupYoga1,
    ]);

    await putExercises(users.a, g1, { allowAll: false }).expect(400);
    await putExercises(users.a, g1, { allowAll: false, names: [] }).expect(400);
    await putExercises(users.a, g1, {
      allowAll: false,
      names: ['   '],
    }).expect(400);
    await putExercises(users.a, g1, {
      allowAll: false,
      names: ['a'.repeat(31)],
    }).expect(400);
    await putExercises(users.a, g1, { names: ['러닝'] }).expect(400); // allowAll 누락

    // 400 이후에도 allowAll=true 상태가 유지된다
    const afterRes = await request(server())
      .get(`/groups/${g1}/exercises`)
      .set(authOf(users.a))
      .expect(200);
    expect((afterRes.body as GroupExercisesResponse).allowAll).toBe(true);

    // 다시 제한: g1은 러닝+요가, g2는 수영+러닝 (g3는 모두 허용)
    await putExercises(users.a, g1, {
      allowAll: false,
      names: ['러닝', '요가'],
    }).expect(200);
    await putExercises(users.a, groupIds[1], {
      allowAll: false,
      names: ['수영', '러닝'],
    }).expect(200);
  });

  it('5. 그룹장이 아닌 멤버의 PUT은 403, 비멤버의 GET/PUT도 403, 없는 그룹은 404이다', async () => {
    const [g1] = groupIds;

    await putExercises(users.b, g1, { allowAll: true }).expect(403);
    await request(server())
      .get(`/groups/${g1}/exercises`)
      .set(authOf(users.c))
      .expect(403);
    await putExercises(users.c, g1, { allowAll: true }).expect(403);
    await putExercises(users.a, '999999999', { allowAll: true }).expect(404);

    const res = await request(server())
      .get(`/groups/${g1}/exercises`)
      .set(authOf(users.a))
      .expect(200);
    expect((res.body as GroupExercisesResponse).allowAll).toBe(false);
  });

  it('6. GET /exercises/selectable: mine은 개인 종목, groups는 allowAll=false인 그룹의 허용 종목(그룹 전용 종목)만 나온다', async () => {
    const [g1, g2, g3] = groupIds;

    const resA = await request(server())
      .get('/exercises/selectable')
      .set(authOf(users.a))
      .expect(200);
    const bodyA = resA.body as SelectableResponse;

    expect(bodyA).not.toHaveProperty('defaults');
    expect(bodyA.mine).toEqual([
      { id: runningA, name: '러닝' },
      { id: swimmingA, name: '수영' },
    ]);
    const byGroup = new Map(
      bodyA.groups.map((group) => [group.groupId, group]),
    );
    expect([...byGroup.keys()].sort()).toEqual([g1, g2].sort());
    expect(byGroup.has(g3)).toBe(false);
    expect(byGroup.get(g1)!.exercises).toEqual([
      { id: groupRunning1, name: '러닝' },
      { id: groupYoga1, name: '요가' },
    ]);
    expect(byGroup.get(g2)!.exercises.map((exercise) => exercise.name)).toEqual(
      ['수영', '러닝'],
    );

    const resB = await request(server())
      .get('/exercises/selectable')
      .set(authOf(users.b))
      .expect(200);
    const bodyB = resB.body as SelectableResponse;
    expect(bodyB.mine).toEqual([{ id: runningB, name: '러닝' }]);
    expect(bodyB.groups.map((group) => group.groupId).sort()).toEqual(
      [g1, g2].sort(),
    );
  });

  it('7. GET /exercises/:id/groups: 모두 허용 그룹 + 같은 이름을 허용한 제한 그룹만 나온다 (이름 기준)', async () => {
    const [g1, g2, g3] = groupIds;

    // 러닝: g1, g2는 러닝을 허용, g3는 모두 허용 -> 모두. 정렬은 참여순
    expect(await groupsForExercise(users.a, runningA)).toEqual([g1, g2, g3]);
    // 수영: g1은 수영 미허용이라 제외
    expect(await groupsForExercise(users.a, swimmingA)).toEqual([g2, g3]);
    // B의 개인 러닝: B가 속한 g1, g2만 (g3 비멤버)
    expect(await groupsForExercise(users.b, runningB)).toEqual([g1, g2]);
    // 그룹 전용 종목 id로도 조회할 수 있다 (내가 속한 그룹의 허용 종목)
    expect(await groupsForExercise(users.b, groupRunning1)).toEqual([g1, g2]);

    // 응답 형태는 GET /groups와 동일
    const res = await request(server())
      .get(`/exercises/${runningA}/groups`)
      .set(authOf(users.a))
      .expect(200);
    const first = (res.body as GroupListItem[])[0];
    expect(first).toHaveProperty('last_shared_at');
    expect(first.memberCount).toBe(2);

    // 사용할 수 없는 종목은 403, 없는 종목은 404
    await request(server())
      .get(`/exercises/${runningA}/groups`)
      .set(authOf(users.b))
      .expect(403);
    await request(server())
      .get(`/exercises/${groupRunning1}/groups`)
      .set(authOf(users.c))
      .expect(403);
    await request(server())
      .get('/exercises/999999999/groups')
      .set(authOf(users.a))
      .expect(404);
  });

  it('8. 그룹 멤버는 그룹 전용 종목으로 기록을 만들 수 있고 비멤버는 403이다', async () => {
    const create = (user: { token: string }, exerciseId: string) =>
      request(server())
        .post('/records')
        .set(authOf(user))
        .field('exerciseId', exerciseId)
        .attach('startFile', TEST_IMAGE_PATH)
        .attach('endFile', TEST_IMAGE_PATH);

    const res = await create(users.b, groupRunning1).expect(201);
    const body = res.body as RecordResponse;
    expect(body.exercise_id).toBe(groupRunning1);
    expect(body.exercise_type).toBe('러닝');

    await create(users.c, groupRunning1).expect(403);
  });

  it('9. 제한 그룹에 허용되지 않은 이름은 403, 같은 이름은 개인/그룹 전용 종목 구분 없이 공유된다', async () => {
    const [g1, g2, g3] = groupIds;

    // g1은 러닝/요가만 허용: 수영은 403
    const denied = await share(users.a, recordSwimmingA, g1).expect(403);
    expect((denied.body as { message: string }).message).toBe(
      '이 그룹에서 허용되지 않은 종목입니다.',
    );
    expect(
      await prisma.record_shares.count({
        where: {
          group_id: BigInt(g1),
          record_id: BigInt(recordSwimmingA),
        },
      }),
    ).toBe(0);

    // 개인 종목 '러닝'은 이름이 같은 그룹 전용 종목 '러닝'을 허용한 g1, g2 모두에 공유할 수 있다
    await share(users.a, recordRunningA, g1).expect(201);
    await share(users.a, recordRunningA, g2).expect(201);
    // 모든 종목 허용 그룹(g3)도 성공
    await share(users.a, recordRunningA, g3).expect(201);
    // 수영은 g2(허용)와 g3(모두 허용)에는 공유할 수 있다
    await share(users.a, recordSwimmingA, g2).expect(201);
    await share(users.a, recordSwimmingA, g3).expect(201);

    // B의 개인 종목 '러닝'도 이름이 같으므로 g1에 공유할 수 있다
    const recordRunningB = await createRecordRow(users.b.id, runningB);
    await share(users.b, recordRunningB, g1).expect(201);
  });

  it('10. 허용 목록을 나중에 바꿔도 이미 공유된 기록은 피드에 그대로 보인다', async () => {
    const [g1] = groupIds;

    await putExercises(users.a, g1, {
      allowAll: false,
      names: ['요가'],
    }).expect(200);

    const res = await request(server())
      .get(`/groups/${g1}/feed`)
      .set(authOf(users.a))
      .expect(200);
    const body = res.body as FeedResponse;

    expect(body.locked).toBe(false);
    expect(body.records.map((record) => record.recordId)).toContain(
      recordRunningA,
    );
    expect(body.records.every((record) => record.exerciseType === '러닝')).toBe(
      true,
    );
  });

  it('11. 그룹 전용 종목은 삭제할 수 없다 (403)', async () => {
    await request(server())
      .delete(`/exercises/${groupRunning1}`)
      .set(authOf(users.a))
      .expect(403);
    await request(server())
      .delete(`/exercises/${groupRunning1}`)
      .set(authOf(users.b))
      .expect(403);
  });

  it('12. 주간 통계 byExercise는 종목 이름 기준으로 합산한다 (개인 종목과 그룹 전용 종목이 같은 이름이면 합쳐진다)', async () => {
    const weekMonday = new Date(Date.UTC(2020, 0, 6)); // 기록이 없는 과거 주 (2020-01-06 월요일)
    await prisma.records.createMany({
      data: [
        {
          user_id: users.a.id,
          exercise_id: BigInt(runningA), // 개인 종목 '러닝'
          duration_sec: 100,
          start_image_url: DUMMY_IMAGE_URL,
          end_image_url: DUMMY_IMAGE_URL,
          record_date: weekMonday,
        },
        {
          user_id: users.a.id,
          exercise_id: BigInt(groupRunning1), // 그룹 전용 종목 '러닝'
          duration_sec: 200,
          start_image_url: DUMMY_IMAGE_URL,
          end_image_url: DUMMY_IMAGE_URL,
          record_date: weekMonday,
        },
        {
          user_id: users.a.id,
          exercise_id: BigInt(swimmingA),
          duration_sec: 50,
          start_image_url: DUMMY_IMAGE_URL,
          end_image_url: DUMMY_IMAGE_URL,
          record_date: weekMonday,
        },
      ],
    });

    const res = await request(server())
      .get('/stats/weekly')
      .query({ weekStart: '2020-01-06' })
      .set(authOf(users.a))
      .expect(200);
    const body = res.body as WeeklyStats;

    expect(body.byExercise).toEqual([
      { exerciseType: '러닝', totalSeconds: 300, count: 2 },
      { exerciseType: '수영', totalSeconds: 50, count: 1 },
    ]);
  });
});
