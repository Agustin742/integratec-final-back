import { randomUUID } from 'node:crypto';
import { Logger, type INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { RegistrationPath } from '@aula/contracts';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { SessionVerifier } from '../auth/session-verifier.service';
import { configureHttp } from '../http/configure-http';
import { buildOpenApiDocument } from '../openapi/openapi-document';
import { PrismaService } from '../prisma/prisma.service';

const base = {
  bodyId: 'male',
  hairId: 'afro',
  topId: 'hoodie',
  hairColor: '#6C4D48',
  clothingColor: '#5B4F96',
};
describe('Own profile and base avatar (#20)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const config = authTestConfig();
  const password = 'syntheticProfilePassword1';
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const emails = ids.map((id) => `profile.${id}@example.test`);
  let token: string;
  let otherToken: string;
  let revoked: string;
  let expired: string;
  let tampered: string;
  const routes = [
    ['get', '/users/me', undefined],
    ['patch', '/users/me/profile', { displayName: 'Changed' }],
  ] as const;

  const me = (credential = token) =>
    request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${credential}`)
      .expect(200);
  const login = async (index = 0) => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: emails[index], password })
      .expect(200);
    return res.body.accessToken as string;
  };
  const patch = (path: string, body: object) =>
    request(app.getHttpServer())
      .patch(`/users/me/${path}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const envelope = (body: unknown, code: string, field?: string) => {
    expect(body).toEqual({
      error: {
        code,
        message: expect.any(String),
        correlationId: expect.any(String),
        ...(field
          ? {
              details: expect.arrayContaining([
                { field, messages: expect.arrayContaining([expect.any(String)]) },
              ]),
            }
          : {}),
      },
    });
  };

  beforeAll(async () => {
    // The runner supplies an isolated DATABASE_URL; fixtures and cleanup are UUID-scoped.
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);
    const passwordHash = await bcrypt.hash(password, 4);
    for (const [index, id] of ids.entries()) {
      await prisma.user.create({
        data: {
          id,
          email: emails[index],
          displayName: 'Profile Tester',
          passwordHash,
          registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          ...(index === 1 ? { avatarConfig: { create: { appearance: {} } } } : {}),
        },
      });
    }
    token = await login();
    otherToken = await login(1);
    revoked = await login();
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Authorization', `Bearer ${revoked}`)
      .expect(204);
    const claims = new JwtService().decode<{ sub: string; sid: string }>(token);
    expired = await new JwtService().signAsync(
      { sub: claims.sub, sid: claims.sid },
      { secret: config.jwtSecret, algorithm: 'HS256', expiresIn: -1 },
    );
    tampered = await new JwtService().signAsync(
      { sub: ids[1], sid: claims.sid },
      { secret: config.jwtSecret, algorithm: 'HS256', expiresIn: 900 },
    );
  });

  beforeEach(async () => {
    // Each test owns a clean baseline; unsupported appearance fixtures stay intact within a test.
    await prisma.avatarConfiguration.deleteMany({ where: { userId: { in: ids } } });
    await prisma.avatarConfiguration.create({ data: { userId: ids[1], appearance: {} } });
    await prisma.user.updateMany({
      where: { id: { in: ids } },
      data: { displayName: 'Profile Tester' },
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.session.deleteMany({ where: { userId: { in: ids } } });
      await prisma.avatarConfiguration.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await app?.close();
  });

  it('returns only the caller safe profile and default appearance', async () => {
    expect((await me()).body).toEqual({
      id: ids[0],
      email: emails[0],
      displayName: 'Profile Tester',
      avatar: base,
    });
  });

  for (const [method, path, body] of routes) {
    it.each(['missing', 'malformed', 'expired', 'revoked', 'tampered'])(
      `rejects %s authentication on ${method.toUpperCase()} ${path}`,
      async (kind) => {
        const before = (await me()).body;
        const other = (await me(otherToken)).body;
        const credentials: Record<string, string> = {
          malformed: 'not-a-token',
          expired,
          revoked,
          tampered,
        };
        let req = request(app.getHttpServer())[method](path);
        if (kind !== 'missing') req = req.set('Authorization', `Bearer ${credentials[kind]}`);
        if (body) req = req.send(body);
        const res = await req.expect(401);
        envelope(res.body, 'UNAUTHENTICATED');
        expect((await me()).body).toEqual(before);
        expect((await me(otherToken)).body).toEqual(other);
      },
    );
  }

  it('reads absent and empty legacy configurations without creating or updating rows', async () => {
    expect(await prisma.avatarConfiguration.findUnique({ where: { userId: ids[0] } })).toBeNull();
    await me();
    expect(
      (await patch('profile', { displayName: 'No avatar row' }).expect(200)).body.avatar,
    ).toEqual(base);
    expect(await prisma.avatarConfiguration.findUnique({ where: { userId: ids[0] } })).toBeNull();
    const before = await prisma.avatarConfiguration.findUniqueOrThrow({
      where: { userId: ids[1] },
    });
    expect((await me(otherToken)).body.avatar).toEqual(base);
    await request(app.getHttpServer())
      .patch('/users/me/profile')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ displayName: 'Empty appearance' })
      .expect(200);
    expect(
      await prisma.avatarConfiguration.findUniqueOrThrow({ where: { userId: ids[1] } }),
    ).toEqual(before);
  });

  it('trims profile names, accepts 1 and 100 characters, and persists across fresh login', async () => {
    for (const name of ['A', 'X'.repeat(100), 'Profile Updated']) {
      const res = await patch('profile', { displayName: `  ${name}  ` }).expect(200);
      expect(res.body).toEqual({
        id: ids[0],
        email: emails[0],
        displayName: name,
        avatar: base,
      });
      expect((await me(await login())).body).toEqual(res.body);
    }
    expect((await me(otherToken)).body.displayName).toBe('Profile Tester');
  });

  it.each(routes)('verifies the session once for %s %s', async (method, path, body) => {
    const verify = vi.spyOn(app.get(SessionVerifier), 'verifyAuthorizationHeader');
    try {
      let req = request(app.getHttpServer())[method](path).set('Authorization', `Bearer ${token}`);
      if (body) req = req.send(body);
      await req.expect(200);
      expect(verify).toHaveBeenCalledExactlyOnceWith(`Bearer ${token}`);
    } finally {
      verify.mockRestore();
    }
  });

  it.each([
    'José 李',
    'أحمد',
    'अनुजा',
    'علی\u200cرضا',
    '👩\u200d🏫 Teacher',
    'O’Connor-Smith',
    'A\u0301',
  ])('preserves ordinary Unicode names and joiners: %s', async (displayName) => {
    const res = await patch('profile', { displayName: `  ${displayName}  ` }).expect(200);
    expect(res.body.displayName).toBe(displayName);
    expect((await me()).body.displayName).toBe(displayName);
  });

  const invalidProfiles = [
    [{}, 'displayName'],
    [{ displayName: '   ' }, 'displayName'],
    [{ displayName: 'x'.repeat(101) }, 'displayName'],
    [{ displayName: null }, 'displayName'],
    [{ displayName: 3 }, 'displayName'],
    ...[
      '\u200b',
      '\u200c\u200d',
      '\u00ad\u034f\u061c\ufeff',
      '\u3164\uffa0',
      '\u115f\u1160',
      '\u2028',
      '\u2029',
      '\u0301\u2800',
      '\u2028Ana',
      'Ana\u2029',
      'A\u2028na',
    ].map((displayName) => [{ displayName }, 'displayName'] as const),
    // Exhaust both control ranges, including trim-removable controls at either edge.
    ...Array.from({ length: 65 }, (_, index) =>
      String.fromCharCode(index < 32 ? index : index + 95),
    )
      .flatMap((control) => [control + 'Ana', 'Ana' + control, 'A' + control + 'na'])
      .map((displayName) => [{ displayName }, 'displayName'] as const),
    [{ displayName: 'Hack', userId: ids[1] }, 'userId'],
    [{ displayName: 'Hack', email: 'hack@example.test' }, 'email'],
  ] as const;
  it.each(invalidProfiles)('rejects invalid profile %j atomically', async (input, field) => {
    const before = await prisma.user.findMany({
      where: { id: { in: ids } },
      orderBy: { id: 'asc' },
    });
    const appearances = await prisma.avatarConfiguration.findMany({
      where: { userId: { in: ids } },
    });
    const other = (await me(otherToken)).body;
    const res = await patch('profile', input).expect(400);
    envelope(res.body, 'VALIDATION_FAILED', field);
    expect(
      await prisma.user.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } }),
    ).toEqual(before);
    expect(await prisma.avatarConfiguration.findMany({ where: { userId: { in: ids } } })).toEqual(
      appearances,
    );
    expect((await me(otherToken)).body).toEqual(other);
  });

  it('does not expose or target another user through path or query tampering', async () => {
    const before = (await me(otherToken)).body;
    const query = await request(app.getHttpServer())
      .get(`/users/me?userId=${ids[1]}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(query.body.id).toBe(ids[0]);
    await request(app.getHttpServer())
      .patch(`/users/${ids[1]}/profile`)
      .set('Authorization', `Bearer ${token}`)
      .send({ displayName: 'Hack' })
      .expect(404);
    expect((await me(otherToken)).body).toEqual(before);
  });

  it('projects valid stored JSON to five fields without writing on GET or name PATCH', async () => {
    await prisma.avatarConfiguration.create({
      data: {
        userId: ids[2],
        appearance: { ...base, internalSecret: 'synthetic-internal-do-not-expose' },
      },
    });
    const credential = await login(2);
    expect((await me(credential)).body.avatar).toEqual(base);
    const before = await prisma.avatarConfiguration.findUniqueOrThrow({
      where: { userId: ids[2] },
    });
    const res = await request(app.getHttpServer())
      .patch('/users/me/profile')
      .set('Authorization', `Bearer ${credential}`)
      .send({ displayName: 'Supported' })
      .expect(200);
    expect(res.body.avatar).toEqual(base);
    expect(
      await prisma.avatarConfiguration.findUniqueOrThrow({ where: { userId: ids[2] } }),
    ).toEqual(before);
  });

  it.each(
    [
      Prisma.JsonNull,
      [],
      'synthetic-private-json',
      7,
      { accessoryId: 'synthetic-private-json' },
      { ...base, bodyId: 'unknown' },
      { ...base, hairId: 'original' },
      { ...base, hairColor: null },
      { ...base, clothingColor: ['#5B4F96'] },
    ].map((appearance) => ({ appearance })),
  )(
    'defaults unsupported stored appearance $appearance without changing it on GET or name PATCH',
    async ({ appearance }) => {
      await prisma.avatarConfiguration.create({ data: { userId: ids[2], appearance } });
      const credential = await login(2);
      const before = await prisma.avatarConfiguration.findUniqueOrThrow({
        where: { userId: ids[2] },
      });
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        expect((await me(credential)).body.avatar).toEqual(base);
        const res = await request(app.getHttpServer())
          .patch('/users/me/profile')
          .set('Authorization', `Bearer ${credential}`)
          .send({ displayName: 'Recovered Profile' })
          .expect(200);
        expect(res.body).toEqual({
          id: ids[2],
          email: emails[2],
          displayName: 'Recovered Profile',
          avatar: base,
        });
        expect((await me(credential)).body).toEqual(res.body);
        expect(warn.mock.calls).toEqual(
          Array.from({ length: 3 }, () => [
            'Unsupported stored base appearance; using default avatar.',
          ]),
        );
        expect(
          await prisma.avatarConfiguration.findUniqueOrThrow({ where: { userId: ids[2] } }),
        ).toEqual(before);
        expect((await me(otherToken)).body.displayName).toBe('Profile Tester');
      } finally {
        warn.mockRestore();
      }
    },
  );

  it('publishes the authenticated routes, response DTOs and required snapshot fields', () => {
    const doc = buildOpenApiDocument(app);
    for (const [method, path] of routes) {
      expect(doc.paths[path]?.[method]?.security).toEqual([{ bearer: [] }]);
      expect(doc.paths[path]?.[method]?.responses?.['200']).toBeDefined();
      expect(doc.paths[path]?.[method]?.responses?.['401']).toBeDefined();
      if (method === 'patch') expect(doc.paths[path]?.[method]?.responses?.['400']).toBeDefined();
    }
    expect(doc.components?.schemas?.AvatarDto).toMatchObject({
      required: ['bodyId', 'hairId', 'topId', 'hairColor', 'clothingColor'],
    });
    expect(doc.components?.schemas?.OwnProfileDto).toMatchObject({
      required: ['id', 'email', 'displayName', 'avatar'],
    });
  });

  it('keeps health, registration validation and login behavior wired through AppModule', async () => {
    const health = await request(app.getHttpServer()).get('/health').expect(200);
    expect(health.body.status).toBe('ok');
    const invalid = await request(app.getHttpServer()).post('/auth/register').send({}).expect(400);
    expect(invalid.body.error.code).toBe('VALIDATION_FAILED');
    await login();
  });
});
