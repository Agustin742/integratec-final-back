import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { RegistrationPath } from '@aula/contracts';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { authTestConfig } from '../auth/testing/auth-test-config';
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
    expect(await prisma.avatarConfiguration.findUnique({ where: { userId: ids[0] } })).toBeNull();
    const before = await prisma.avatarConfiguration.findUniqueOrThrow({
      where: { userId: ids[1] },
    });
    expect((await me(otherToken)).body.avatar).toEqual(base);
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

  const invalidProfiles = [
    [{}, 'displayName'],
    [{ displayName: '   ' }, 'displayName'],
    [{ displayName: 'x'.repeat(101) }, 'displayName'],
    [{ displayName: null }, 'displayName'],
    [{ displayName: 3 }, 'displayName'],
    [{ displayName: 'Hack', userId: ids[1] }, 'userId'],
    [{ displayName: 'Hack', email: 'hack@example.test' }, 'email'],
  ] as const;
  it.each(invalidProfiles)('rejects invalid profile %j atomically', async (input, field) => {
    const before = (await me()).body;
    const other = (await me(otherToken)).body;
    const res = await patch('profile', input).expect(400);
    envelope(res.body, 'VALIDATION_FAILED', field);
    expect((await me()).body).toEqual(before);
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

  it('sanitizes supported stored JSON and fails safely on unsupported nonempty data without a write', async () => {
    await prisma.avatarConfiguration.create({
      data: {
        userId: ids[2],
        appearance: { ...base, internalSecret: 'synthetic-internal-do-not-expose' },
      },
    });
    const credential = await login(2);
    expect((await me(credential)).body.avatar).toEqual(base);
    await prisma.avatarConfiguration.update({
      where: { userId: ids[2] },
      data: { appearance: { accessoryId: 'synthetic-internal-do-not-expose' } },
    });
    const before = await prisma.avatarConfiguration.findUniqueOrThrow({
      where: { userId: ids[2] },
    });
    const res = await request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${credential}`)
      .expect(500);
    envelope(res.body, 'INTERNAL_ERROR');
    expect(
      await prisma.avatarConfiguration.findUniqueOrThrow({ where: { userId: ids[2] } }),
    ).toEqual(before);
  });

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
