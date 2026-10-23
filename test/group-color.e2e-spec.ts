import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  PALETTE,
  PALETTE_KEYS,
  getColorHex,
} from '../src/common/constants/palette.constants';
import { createTestApp } from './helpers/app.helper';
import { createTestUser, getAccessToken } from './helpers/auth.helper';
import { cleanupTestData, disconnectPrisma } from './helpers/cleanup.helper';

const runId = Date.now();

interface GroupResponse {
  id: string;
  name: string;
  invite_code: string;
  color: string;
  colorHex: string | null;
  memberCount?: number;
}

interface SelectableResponse {
  groups: {
    groupId: string;
    color: string;
    colorHex: string | null;
  }[];
}

// 그룹 색상(팔레트 key + hex): 생성 시 지정/무작위 배정, 그룹장 변경, 조회 응답 반영
describe('그룹 색상 (e2e)', () => {
  let app: INestApplication<App>;

  const users = {
    a: { email: `sporit-e2e-gc-a-${runId}@example.com`, id: '', token: '' },
    b: { email: `sporit-e2e-gc-b-${runId}@example.com`, id: '', token: '' },
  };
  const password = 'Test1234!';

  const groupIds: string[] = [];
  let groupWithColor: GroupResponse; // color: 'purple'로 생성
  let groupRandom: GroupResponse; // color 미지정

  const server = () => app.getHttpServer();
  const authOf = (user: { token: string }) => ({
    Authorization: `Bearer ${user.token}`,
  });

  const createGroup = (body: object) =>
    request(server()).post('/groups').set(authOf(users.a)).send(body);

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
    await cleanupTestData({
      userIds: Object.values(users).map((user) => user.id),
      groupIds: groupIds.map((id) => BigInt(id)),
    });
    await disconnectPrisma();
  });

  it('1. 그룹 생성 시 color를 지정하면 그대로 저장되고 colorHex가 함께 내려온다', async () => {
    const res = await createGroup({
      name: `E2E 색상 그룹 ${runId}`,
      color: 'purple',
    }).expect(201);
    groupWithColor = res.body as GroupResponse;
    groupIds.push(groupWithColor.id);

    expect(groupWithColor.color).toBe('purple');
    expect(groupWithColor.colorHex).toBe('#7B2CBF');
  });

  it('2. color를 지정하지 않으면 팔레트 안의 값이 배정된다', async () => {
    const res = await createGroup({
      name: `E2E 무작위 색상 그룹 ${runId}`,
    }).expect(201);
    groupRandom = res.body as GroupResponse;
    groupIds.push(groupRandom.id);

    expect(PALETTE_KEYS).toContain(groupRandom.color);
    expect(groupRandom.colorHex).toBe(getColorHex(groupRandom.color));
    expect(PALETTE.map((color) => color.hex)).toContain(groupRandom.colorHex);
  });

  it('3. 팔레트에 없는 color(옛 키 포함)로 그룹을 만들면 400이다', async () => {
    for (const color of ['neon', 'pink', 'green', 'teal', 'indigo', 'gray']) {
      await createGroup({ name: `E2E 잘못된 색 ${color}`, color }).expect(400);
    }
  });

  it('4. GET /groups와 GET /groups/:id 응답에 color/colorHex가 포함된다', async () => {
    const listRes = await request(server())
      .get('/groups')
      .set(authOf(users.a))
      .expect(200);
    const list = listRes.body as GroupResponse[];
    const listed = list.find((group) => group.id === groupWithColor.id)!;
    expect(listed.color).toBe('purple');
    expect(listed.colorHex).toBe('#7B2CBF');
    expect(listed.memberCount).toBe(1); // 기존 memberCount는 그대로
    for (const group of list) {
      expect(group.color).toEqual(expect.any(String));
      expect(group.colorHex).toBe(getColorHex(group.color));
    }

    const detailRes = await request(server())
      .get(`/groups/${groupWithColor.id}`)
      .set(authOf(users.a))
      .expect(200);
    const detail = detailRes.body as GroupResponse;
    expect(detail.color).toBe('purple');
    expect(detail.colorHex).toBe('#7B2CBF');
  });

  it('5. 초대코드로 참여한 응답에도 color/colorHex가 포함된다', async () => {
    const res = await request(server())
      .post('/groups/join')
      .set(authOf(users.b))
      .send({ code: groupWithColor.invite_code })
      .expect(201);
    const body = res.body as GroupResponse;

    expect(body.color).toBe('purple');
    expect(body.colorHex).toBe('#7B2CBF');
  });

  it('6. PATCH /groups/:id: 그룹장은 색을 바꿀 수 있고 응답에 colorHex가 있다', async () => {
    const res = await request(server())
      .patch(`/groups/${groupWithColor.id}`)
      .set(authOf(users.a))
      .send({ color: 'sky' })
      .expect(200);
    const body = res.body as GroupResponse;

    expect(body.id).toBe(groupWithColor.id);
    expect(body.color).toBe('sky');
    expect(body.colorHex).toBe('#39B1D1');
    expect(body.name).toBe(groupWithColor.name); // 다른 필드는 그대로

    // 조회에도 반영된다 (멤버 B가 봐도 같다)
    const detail = await request(server())
      .get(`/groups/${groupWithColor.id}`)
      .set(authOf(users.b))
      .expect(200);
    expect((detail.body as GroupResponse).color).toBe('sky');
  });

  it('7. PATCH /groups/:id: 멤버(비그룹장)는 403, 없는 그룹은 404이다', async () => {
    await request(server())
      .patch(`/groups/${groupWithColor.id}`)
      .set(authOf(users.b))
      .send({ color: 'red' })
      .expect(403);

    await request(server())
      .patch('/groups/999999999')
      .set(authOf(users.a))
      .send({ color: 'red' })
      .expect(404);
    await request(server())
      .patch('/groups/abc')
      .set(authOf(users.a))
      .send({ color: 'red' })
      .expect(404);

    // 거부된 요청은 색을 바꾸지 않는다
    const detail = await request(server())
      .get(`/groups/${groupWithColor.id}`)
      .set(authOf(users.a))
      .expect(200);
    expect((detail.body as GroupResponse).color).toBe('sky');
  });

  it('8. PATCH /groups/:id: 잘못된 색과 빈 body는 400이다', async () => {
    const patch = (body: object) =>
      request(server())
        .patch(`/groups/${groupWithColor.id}`)
        .set(authOf(users.a))
        .send(body);

    await patch({ color: 'neon' }).expect(400);
    await patch({ color: 'pink' }).expect(400); // 옛 팔레트 키
    await patch({}).expect(400);
    await patch({ unknown: 'field' }).expect(400); // 허용되지 않는 필드만 있으면 보낸 필드가 없는 것과 같다
  });

  it('9. 그룹 정보를 내려주는 응답(종목별 공유 가능 그룹, 기록 작성 선택 목록)에도 color/colorHex가 있다', async () => {
    // 허용 종목을 제한해야 selectable.groups에 나온다
    await request(server())
      .put(`/groups/${groupWithColor.id}/exercises`)
      .set(authOf(users.a))
      .send({ allowAll: false, names: ['러닝'] })
      .expect(200);
    const exerciseRes = await request(server())
      .post('/exercises')
      .set(authOf(users.a))
      .send({ name: '러닝' })
      .expect(201);
    const exerciseId = (exerciseRes.body as { id: string }).id;

    const selectable = (
      await request(server())
        .get('/exercises/selectable')
        .set(authOf(users.a))
        .expect(200)
    ).body as SelectableResponse;
    const selectableGroup = selectable.groups.find(
      (group) => group.groupId === groupWithColor.id,
    )!;
    expect(selectableGroup.color).toBe('sky');
    expect(selectableGroup.colorHex).toBe('#39B1D1');

    const groupsForExercise = (
      await request(server())
        .get(`/exercises/${exerciseId}/groups`)
        .set(authOf(users.a))
        .expect(200)
    ).body as GroupResponse[];
    expect(groupsForExercise.length).toBeGreaterThan(0);
    for (const group of groupsForExercise) {
      expect(group.colorHex).toBe(getColorHex(group.color));
    }
  });
});
