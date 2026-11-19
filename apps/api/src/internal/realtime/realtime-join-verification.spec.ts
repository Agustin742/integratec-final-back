import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import {
  ClassroomRole,
  EquippedSlot,
  MembershipState,
  RegistrationPath,
  ShopItemKind,
} from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessModule } from '../../access/access.module';
import { AuthModule } from '../../auth/auth.module';
import { authTestConfig } from '../../auth/testing/auth-test-config';
import { ApiConfigModule } from '../../config/config.module';
import { configureHttp } from '../../http/configure-http';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_AVATAR } from '../../users/avatar.dto';
import { INTERNAL_SERVICE_SECRET_HEADER } from './internal-service.guard';
import { RealtimeJoinModule } from './realtime-join.module';

const ROUTE = '/internal/realtime/join-verification';

describe('POST /internal/realtime/join-verification (#24)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  const config = authTestConfig();
  const ts = Date.now();
  const userIds: string[] = [];
  const classroomIds: string[] = [];
  const sessionIds: string[] = [];

  let memberId: string;
  let strangerId: string;
  let classroomId: string;
  let otherClassroomId: string;
  let memberToken: string;
  let memberSessionId: string;
  let strangerToken: string;

  const post = (body: object, secret: string | null = config.internalServiceSecret) => {
    const req = request(app.getHttpServer()).post(ROUTE);
    return (secret === null ? req : req.set(INTERNAL_SERVICE_SECRET_HEADER, secret)).send(body);
  };

  const makeUser = async (label: string) => {
    const user = await prisma.user.create({
      data: {
        email: `${label}.${ts}@example.com`,
        passwordHash: 'dummy-hash-for-integration-tests',
        displayName: label,
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      },
    });
    userIds.push(user.id);
    return user.id;
  };

  const makeSession = async (
    userId: string,
    overrides: { revokedAt?: Date; expiresAt?: Date } = {},
  ) => {
    const session = await prisma.session.create({
      data: {
        userId,
        expiresAt: overrides.expiresAt ?? new Date(Date.now() + 3_600_000),
        revokedAt: overrides.revokedAt,
      },
    });
    sessionIds.push(session.id);
    const token = await jwt.signAsync({ sub: userId, sid: session.id }, { expiresIn: 900 });
    return { token, sessionId: session.id };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ApiConfigModule.forRoot(config),
        PrismaModule,
        AuthModule,
        AccessModule,
        RealtimeJoinModule,
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    memberId = await makeUser('rt-member');
    strangerId = await makeUser('rt-stranger');

    const classroom = await prisma.classroom.create({
      data: { name: `RT Classroom ${ts}`, independentTeacherId: memberId },
    });
    const other = await prisma.classroom.create({
      data: { name: `RT Other ${ts}`, independentTeacherId: strangerId },
    });
    classroomId = classroom.id;
    otherClassroomId = other.id;
    classroomIds.push(classroom.id, other.id);

    ({ token: memberToken, sessionId: memberSessionId } = await makeSession(memberId));
    ({ token: strangerToken } = await makeSession(strangerId));
  });

  afterAll(async () => {
    await prisma?.classroomMembership.deleteMany({ where: { classroomId: { in: classroomIds } } });
    await prisma?.classroom.deleteMany({ where: { id: { in: classroomIds } } });
    await prisma?.session.deleteMany({ where: { id: { in: sessionIds } } });
    await prisma?.user.deleteMany({ where: { id: { in: userIds } } });
    await app?.close();
  });

  it('answers 200 with the verified identity for a member', async () => {
    const res = await post({ accessToken: memberToken, classroomId }).expect(200);
    expect(res.body).toEqual({
      userId: memberId,
      sessionId: memberSessionId,
      classroomId,
      role: 'TEACHER',
      displayName: 'rt-member',
      appearance: {
        baseAvatar: { ...DEFAULT_AVATAR },
        items: { head: null, face: null, back: null, desk_decor: null },
      },
    });
  });

  describe('appearance (#114)', () => {
    const STORED_BASE_AVATAR = {
      bodyId: 'female',
      hairId: 'afro',
      topId: 'tshirt',
      hairColor: '#AF6D63',
      clothingColor: '#75B7DA',
    };
    const NULL_ITEMS = { head: null, face: null, back: null, desk_decor: null } as const;

    it('answers the default appearance for a member without stored data', async () => {
      const res = await post({ accessToken: memberToken, classroomId }).expect(200);
      expect(res.body.appearance).toEqual({
        baseAvatar: { ...DEFAULT_AVATAR },
        items: NULL_ITEMS,
      });
    });

    it('answers the stored base avatar and equipped items for a student member', async () => {
      await prisma.classroomMembership.create({
        data: {
          classroomId: otherClassroomId,
          userId: memberId,
          role: ClassroomRole.STUDENT,
          state: MembershipState.ACTIVE,
        },
      });
      await prisma.avatarConfiguration.create({
        data: { userId: memberId, appearance: { ...STORED_BASE_AVATAR } },
      });
      const shopItem = await prisma.shopItem.create({
        data: {
          code: `rt-appearance-cap-${ts}`,
          name: 'RT Appearance Cap',
          kind: ShopItemKind.AVATAR_ACCESSORY,
          defaultPrice: 10,
        },
      });
      const equipped = await prisma.equippedItem.create({
        data: {
          classroomId: otherClassroomId,
          studentId: memberId,
          slot: EquippedSlot.HEAD,
          shopItemId: shopItem.id,
        },
      });
      try {
        const res = await post({ accessToken: memberToken, classroomId: otherClassroomId }).expect(
          200,
        );
        expect(res.body.appearance).toEqual({
          baseAvatar: { ...STORED_BASE_AVATAR },
          items: {
            head: {
              slot: 'head',
              shopItemId: shopItem.id,
              shopItemCode: `rt-appearance-cap-${ts}`,
              shopItemName: 'RT Appearance Cap',
              kind: 'AVATAR_ACCESSORY',
            },
            face: null,
            back: null,
            desk_decor: null,
          },
        });
        // Appearance is public data only (#114 acceptance): no private field rides along.
        expect(Object.keys(res.body).sort()).toEqual([
          'appearance',
          'classroomId',
          'displayName',
          'role',
          'sessionId',
          'userId',
        ]);
        expect(JSON.stringify(res.body)).not.toContain('@example.com');
      } finally {
        await prisma.equippedItem.deleteMany({ where: { id: equipped.id } });
        await prisma.shopItem.deleteMany({ where: { id: shopItem.id } });
        await prisma.avatarConfiguration.deleteMany({ where: { userId: memberId } });
        await prisma.classroomMembership.deleteMany({ where: { classroomId: otherClassroomId } });
      }
    });

    it('falls back to the default avatar when the stored appearance is unsupported', async () => {
      await prisma.avatarConfiguration.create({
        data: { userId: memberId, appearance: { junk: 'not-an-avatar' } },
      });
      try {
        const res = await post({ accessToken: memberToken, classroomId }).expect(200);
        expect(res.body.appearance).toEqual({
          baseAvatar: { ...DEFAULT_AVATAR },
          items: NULL_ITEMS,
        });
      } finally {
        await prisma.avatarConfiguration.deleteMany({ where: { userId: memberId } });
      }
    });
  });

  it('maps an active student membership to its role', async () => {
    await prisma.classroomMembership.create({
      data: {
        classroomId: otherClassroomId,
        userId: memberId,
        role: ClassroomRole.STUDENT,
        state: MembershipState.ACTIVE,
      },
    });
    try {
      const res = await post({ accessToken: memberToken, classroomId: otherClassroomId }).expect(
        200,
      );
      expect(res.body).toMatchObject({ userId: memberId, role: 'STUDENT' });
    } finally {
      await prisma.classroomMembership.deleteMany({ where: { classroomId: otherClassroomId } });
    }
  });

  describe('service authentication', () => {
    it('rejects a missing secret with 401', async () => {
      await post({ accessToken: memberToken, classroomId }, null).expect(401);
    });

    it('rejects a wrong secret of the same length with 401', async () => {
      await post(
        { accessToken: memberToken, classroomId },
        'x'.repeat(config.internalServiceSecret.length),
      ).expect(401);
    });

    it('rejects a wrong secret of a different length with 401', async () => {
      await post({ accessToken: memberToken, classroomId }, 'short').expect(401);
    });

    it('does not accept a user Bearer token in place of the service secret', async () => {
      await request(app.getHttpServer())
        .post(ROUTE)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ accessToken: memberToken, classroomId })
        .expect(401);
    });
  });

  describe('session verification', () => {
    it.each([['not-a-jwt'], ['a.b.c']])(
      'rejects malformed token %s with 401',
      async (accessToken) => {
        await post({ accessToken, classroomId }).expect(401);
      },
    );

    it('rejects an expired token with 401', async () => {
      const expired = await jwt.signAsync(
        { sub: memberId, sid: memberSessionId },
        { expiresIn: -10 },
      );
      await post({ accessToken: expired, classroomId }).expect(401);
    });

    it('rejects a revoked session with 401', async () => {
      const { token } = await makeSession(memberId, { revokedAt: new Date() });
      await post({ accessToken: token, classroomId }).expect(401);
    });

    it('rejects an expired session with 401', async () => {
      const { token } = await makeSession(memberId, { expiresAt: new Date(Date.now() - 1000) });
      await post({ accessToken: token, classroomId }).expect(401);
    });
  });

  describe('classroom access', () => {
    it('rejects a non-member with 404', async () => {
      await post({ accessToken: strangerToken, classroomId }).expect(404);
    });

    it('rejects another classroom the user cannot access with 404', async () => {
      await post({ accessToken: memberToken, classroomId: otherClassroomId }).expect(404);
    });

    it('rejects an unknown classroom with 404', async () => {
      await post({
        accessToken: memberToken,
        classroomId: '99999999-9999-4999-8999-999999999999',
      }).expect(404);
    });

    it('denies a linked parent a live join with 403 (parents do not enter the 3D classroom)', async () => {
      const parentId = await makeUser('rt-parent');
      const childId = await makeUser('rt-child');
      const link = await prisma.parentLink.create({
        data: { parentId, childId, classroomId, state: MembershipState.ACTIVE },
      });
      try {
        const { token } = await makeSession(parentId);
        const res = await post({ accessToken: token, classroomId }).expect(403);
        expect(res.body).not.toHaveProperty('role');
        expect(res.body).not.toHaveProperty('userId');
      } finally {
        await prisma.parentLink.delete({ where: { id: link.id } });
      }
    });
  });

  describe('body validation', () => {
    it.each([
      ['a malformed classroomId', { classroomId: 'not-a-uuid' }],
      ['a numeric classroomId', { classroomId: 42 }],
      ['a missing classroomId', {}],
    ])('answers 400 (not 500) for %s', async (_label, extra) => {
      await post({ accessToken: memberToken, ...extra }).expect(400);
    });

    it('answers 400 for a missing accessToken', async () => {
      await post({ classroomId }).expect(400);
    });

    it('answers 400 for an accessToken longer than 4096 characters', async () => {
      await post({ accessToken: 'a'.repeat(4097), classroomId }).expect(400);
    });

    it('answers 400 for unexpected fields', async () => {
      await post({ accessToken: memberToken, classroomId, extra: 1 }).expect(400);
    });

    it('does not echo the token or the secret in error responses', async () => {
      const res = await post({ accessToken: 'bad-token', classroomId }).expect(401);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('bad-token');
      expect(text).not.toContain(config.internalServiceSecret);
    });
  });
});
