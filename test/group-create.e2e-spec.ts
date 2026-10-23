import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  PALETTE_KEYS,
  getColorHex,
} from '../src/common/constants/palette.constants';
import { createTestApp } from './helpers/app.helper';
import { createTestUser, getAccessToken } from './helpers/auth.helper';
import {
  cleanupTestData,
  disconnectPrisma,
  prisma,
} from './helpers/cleanup.helper';

const runId = Date.now();

interface CreatedGroup {
  id: string;
  name: string;
  color: string;
  colorHex: string | null;
  allowAll: boolean;
}

interface GroupExercises {
  allowAll: boolean;
  exercises: { id: string; name: string }[];
}

// POST /groups: 색상과 허용 종목을 한 번에 설정 (한 트랜잭션)
describe('그룹 생성 시 색상과 허용 종목 (e2e)', () => {
  let app: INestApplication<App>;

  const user = {
    email: `sporit-e2e-gcreate-${runId}@example.com`,
    id: '',
    token: '',
  };
  const password = 'Test1234!';
  const groupIds: string[] = [];

  const server = () => app.getHttpServer();
  const authOf = () => ({ Authorization: `Bearer ${user.token}` });
  const post = (body: object) =>
    request(server()).post('/groups').set(authOf()).send(body);
  const countGroups = (name: string) =>
    prisma.groups.count({ where: { owner_id: user.id, name } });

  beforeAll(async () => {
    app = await createTestApp();

    user.id = (await createTestUser(user.email, password)).id;
    user.token = await getAccessToken(user.email, password);
    await request(server()).post('/auth/sync').set(authOf());
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestData({
      userIds: [user.id],
      groupIds: groupIds.map((id) => BigInt(id)),
    });
    await disconnectPrisma();
  });

  it('1. names와 color를 포함해 생성하면 허용 종목과 색이 반영된다', async () => {
    const name = `E2E 생성 허용종목 ${runId}`;
    const res = await post({
      name,
      color: 'sky',
      allowAll: false,
      names: ['  러닝  ', '요가', '러닝', '플랭크   운동'],
    }).expect(201);
    const body = res.body as CreatedGroup;
    groupIds.push(body.id);

    expect(body.color).toBe('sky');
    expect(body.colorHex).toBe('#39B1D1');
    expect(body.allowAll).toBe(false);

    // 허용 종목: 공백 정리, 중복 제거 후 그룹 전용 종목으로 연결된다
    const exercises = (
      await request(server())
        .get(`/groups/${body.id}/exercises`)
        .set(authOf())
        .expect(200)
    ).body as GroupExercises;
    expect(exercises.allowAll).toBe(false);
    expect(exercises.exercises.map((exercise) => exercise.name)).toEqual([
      '러닝',
      '요가',
      '플랭크 운동',
    ]);

    const groupExercises = await prisma.exercises.findMany({
      where: { group_id: BigInt(body.id) },
    });
    expect(groupExercises).toHaveLength(3);
    expect(groupExercises.every((exercise) => exercise.owner_id === null)).toBe(
      true,
    );
    expect(
      await prisma.group_exercises.count({
        where: { group_id: BigInt(body.id) },
      }),
    ).toBe(3);

    // 그룹장 멤버십도 함께 만들어졌다
    expect(
      await prisma.group_members.count({
        where: { group_id: BigInt(body.id), user_id: user.id },
      }),
    ).toBe(1);
  });

  it('2. allowAll/color/names를 생략하면 allowAll=true이고 색은 팔레트 안의 값이다', async () => {
    const res = await post({ name: `E2E 생성 기본값 ${runId}` }).expect(201);
    const body = res.body as CreatedGroup;
    groupIds.push(body.id);

    expect(body.allowAll).toBe(true);
    expect(PALETTE_KEYS).toContain(body.color);
    expect(body.colorHex).toBe(getColorHex(body.color));

    const exercises = (
      await request(server())
        .get(`/groups/${body.id}/exercises`)
        .set(authOf())
        .expect(200)
    ).body as GroupExercises;
    expect(exercises).toEqual({ allowAll: true, exercises: [] });
    expect(
      await prisma.exercises.count({ where: { group_id: BigInt(body.id) } }),
    ).toBe(0);

    // allowAll=true와 빈 names는 모순이 아니다
    const emptyNames = await post({
      name: `E2E 생성 빈names ${runId}`,
      allowAll: true,
      names: [],
    }).expect(201);
    groupIds.push((emptyNames.body as CreatedGroup).id);
    expect((emptyNames.body as CreatedGroup).allowAll).toBe(true);
  });

  it('3. allowAll=false인데 names가 없거나 비어 있으면 400이고 그룹이 만들어지지 않는다', async () => {
    const name = `E2E 생성 names없음 ${runId}`;

    await post({ name, allowAll: false }).expect(400);
    await post({ name, allowAll: false, names: [] }).expect(400);
    await post({ name, allowAll: false, names: ['   '] }).expect(400); // 공백 정리 후 빈 이름
    await post({ name, allowAll: false, names: ['a'.repeat(31)] }).expect(400);

    expect(await countGroups(name)).toBe(0);
  });

  it('4. allowAll=true(또는 생략)인데 names가 있으면 400이고 그룹이 만들어지지 않는다', async () => {
    const name = `E2E 생성 모순 ${runId}`;

    await post({ name, allowAll: true, names: ['러닝'] }).expect(400);
    await post({ name, names: ['러닝'] }).expect(400); // allowAll 생략 = true

    expect(await countGroups(name)).toBe(0);
  });

  it('5. 팔레트에 없는 색은 400이고 그룹이 만들어지지 않는다', async () => {
    const name = `E2E 생성 잘못된색 ${runId}`;

    await post({ name, color: 'neon' }).expect(400);
    await post({
      name,
      color: 'pink',
      allowAll: false,
      names: ['러닝'],
    }).expect(400);

    expect(await countGroups(name)).toBe(0);
  });

  it('6. 허용 종목을 50개까지 한 번에 만들 수 있고 51개는 400이다', async () => {
    const names = Array.from({ length: 50 }, (_, i) => `종목${i}`);
    const res = await post({
      name: `E2E 생성 50개 ${runId}`,
      allowAll: false,
      names,
    }).expect(201);
    const body = res.body as CreatedGroup;
    groupIds.push(body.id);

    expect(
      await prisma.group_exercises.count({
        where: { group_id: BigInt(body.id) },
      }),
    ).toBe(50);

    const name51 = `E2E 생성 51개 ${runId}`;
    await post({
      name: name51,
      allowAll: false,
      names: [...names, '종목50'],
    }).expect(400);
    expect(await countGroups(name51)).toBe(0);
  });
});
