import express, { type Application } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { configureExpress } from '../server';

const SECRET = 'test-only-secret-with-at-least-32-characters';
const USER = '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01';
const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const REVISION = 1;

/** A full, valid `MemberAppearance` payload; vary the hair color to tell snapshots apart. */
const APPEARANCE = {
  baseAvatar: {
    bodyId: 'female',
    hairId: 'afro',
    topId: 'basic-tshirt',
    hairColor: '#353849',
    clothingColor: '#75B7DA',
  },
  items: {
    head: {
      slot: 'head',
      shopItemId: '20000000-0000-4000-8000-000000000001',
      shopItemCode: 'head_cap',
      shopItemName: 'Blue Classroom Cap',
      kind: 'AVATAR_ACCESSORY',
    },
    face: null,
    back: null,
    desk_decor: null,
  },
} as const;

const makeApp = (applied = 1) => {
  const directory = {
    evict: vi.fn(),
    applyAppearance: vi.fn().mockReturnValue(applied),
    applyDeskCount: vi.fn(),
    broadcastChatEvent: vi.fn(),
  };
  const app = configureExpress(express(), { internal: { serviceSecret: SECRET, directory } });
  return { app, directory };
};

/** `secret` omitted means no header at all; `null` is kept for symmetry with the eviction spec. */
const post = (app: Application, body: object, secret?: string | null) => {
  const req = request(app).post('/internal/appearance');
  return (secret == null ? req : req.set('x-internal-service-secret', secret)).send(body);
};

describe('POST /internal/appearance', () => {
  it('applies the appearance to the classroom and answers 204 without revealing the rooms', async () => {
    const { app, directory } = makeApp();

    const res = await post(
      app,
      {
        classroomId: CLASSROOM,
        userId: USER,
        appearanceRevision: REVISION,
        appearance: APPEARANCE,
      },
      SECRET,
    ).expect(204);

    expect(res.text).toBe('');
    expect(directory.applyAppearance).toHaveBeenCalledExactlyOnceWith(
      CLASSROOM,
      USER,
      REVISION,
      APPEARANCE,
    );
  });

  it('answers 204 when no room or avatar matched, so replays are harmless', async () => {
    const { app } = makeApp(0);

    await post(
      app,
      {
        classroomId: CLASSROOM,
        userId: USER,
        appearanceRevision: REVISION,
        appearance: APPEARANCE,
      },
      SECRET,
    ).expect(204);
  });

  it.each([
    ['a missing secret', undefined],
    ['a wrong secret', 'x'.repeat(SECRET.length)],
    ['a shorter secret', SECRET.slice(1)],
    ['an empty secret', ''],
  ])('answers 401 and applies nothing for %s', async (_label, secret) => {
    const { app, directory } = makeApp();

    await post(
      app,
      {
        classroomId: CLASSROOM,
        userId: USER,
        appearanceRevision: REVISION,
        appearance: APPEARANCE,
      },
      secret,
    ).expect(401);

    expect(directory.applyAppearance).not.toHaveBeenCalled();
  });

  it.each([
    ['an empty body', {}],
    [
      'a malformed classroomId',
      { classroomId: 'x', userId: USER, appearanceRevision: REVISION, appearance: APPEARANCE },
    ],
    [
      'a missing userId',
      { classroomId: CLASSROOM, appearanceRevision: REVISION, appearance: APPEARANCE },
    ],
    [
      'a malformed userId',
      { classroomId: CLASSROOM, userId: 'x', appearanceRevision: REVISION, appearance: APPEARANCE },
    ],
    ['a missing revision', { classroomId: CLASSROOM, userId: USER, appearance: APPEARANCE }],
    [
      'a malformed revision',
      { classroomId: CLASSROOM, userId: USER, appearanceRevision: -1, appearance: APPEARANCE },
    ],
    [
      'a missing appearance',
      { classroomId: CLASSROOM, userId: USER, appearanceRevision: REVISION },
    ],
    [
      'a base avatar with a missing field',
      {
        classroomId: CLASSROOM,
        userId: USER,
        appearanceRevision: REVISION,
        appearance: {
          ...APPEARANCE,
          baseAvatar: { ...APPEARANCE.baseAvatar, hairColor: undefined },
        },
      },
    ],
    [
      'an items slot not matching its key',
      {
        classroomId: CLASSROOM,
        userId: USER,
        appearanceRevision: REVISION,
        appearance: {
          ...APPEARANCE,
          items: { ...APPEARANCE.items, face: { ...APPEARANCE.items.head, slot: 'head' } },
        },
      },
    ],
    [
      'an appearance with an unexpected field',
      {
        classroomId: CLASSROOM,
        userId: USER,
        appearanceRevision: REVISION,
        appearance: { ...APPEARANCE, email: 'leak@example.test' },
      },
    ],
    [
      'an unexpected top-level field',
      {
        classroomId: CLASSROOM,
        userId: USER,
        appearanceRevision: REVISION,
        appearance: APPEARANCE,
        everyone: true,
      },
    ],
  ])('answers 400 and applies nothing for %s', async (_label, body) => {
    const { app, directory } = makeApp();

    await post(app, body, SECRET).expect(400);

    expect(directory.applyAppearance).not.toHaveBeenCalled();
  });

  it('is not mounted when no internal secret is configured', async () => {
    const app = configureExpress(express());
    await post(app, {
      classroomId: CLASSROOM,
      userId: USER,
      appearanceRevision: REVISION,
      appearance: APPEARANCE,
    }).expect(404);
  });
});
