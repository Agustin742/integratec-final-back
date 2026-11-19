import { randomUUID } from 'node:crypto';
import { ForbiddenException, type INestApplication } from '@nestjs/common';
import {
  ClassroomRole,
  EquippedSlot,
  MembershipState,
  RegistrationPath,
  ShopItemKind,
} from '@prisma/client';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { authTestConfig } from '../auth/testing/auth-test-config';
import { loadIsolatedTestDatabaseUrl } from '../config/testing/isolated-test-database';
import { configureHttp } from '../http/configure-http';
import { PrismaService } from '../prisma/prisma.service';
import { REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT } from '../platform/realtime/realtime-events';
import { AvatarAccessPort } from './avatar-access.port';

// Caller-provisioned disposable PostgreSQL database only. Append-only UUID-scoped fixtures.
const databaseUrl = loadIsolatedTestDatabaseUrl();

/** A valid, palette-checked base avatar the tests patch to. */
const PATCHED = {
  bodyId: 'female',
  hairId: 'original',
  topId: 'tshirt',
  hairColor: '#AF6D63',
  clothingColor: '#F4E6D2',
} as const;

const password = 'syntheticAppearancePassword1';

function makeIds() {
  return {
    /** The patched user: independent teacher of A, student in B, Owner of the school of C. */
    main: randomUUID(),
    /** Another teacher: owns B (where main is enrolled), P and the stranger classroom X. */
    otherTeacher: randomUUID(),
    /** A child of classroom P linked to main as a parent (no live access). */
    child: randomUUID(),
    classroomA: randomUUID(), // main's own independent classroom (no membership row)
    classroomB: randomUUID(), // main is an ACTIVE student here, with head equipped
    classroomC: randomUUID(), // school classroom; main is the school Owner (no membership row)
    classroomP: randomUUID(), // main is a linked parent (accessible, but no live access)
    classroomX: randomUUID(), // no relationship at all
    school: randomUUID(),
    shopItem: randomUUID(),
  };
}

interface AppearanceEventPayload {
  classroomId: string;
  userId: string;
  appearance: {
    baseAvatar: Record<string, string>;
    items: Record<string, unknown>;
  };
}

describe('PATCH /users/me/avatar realtime appearance events (#114)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ids = makeIds();
  let token: string;
  let childToken: string;
  const mainEmail = (): string => `appearance.main.${ids.main}@example.invalid`;
  const childEmail = (): string => `appearance.child.${ids.child}@example.invalid`;

  const events = (userId: string) =>
    prisma.outboxEvent.findMany({
      where: {
        type: REALTIME_CLASSROOM_APPEARANCE_CHANGED_EVENT,
        payload: { path: ['userId'], equals: userId },
      },
      orderBy: { occurredAt: 'asc' },
    });
  const payloads = async (userId: string): Promise<AppearanceEventPayload[]> =>
    (await events(userId)).map((row) => row.payload as unknown as AppearanceEventPayload);
  const patchAvatar = (body: object, credential = token) =>
    request(app.getHttpServer())
      .patch('/users/me/avatar')
      .set('Authorization', `Bearer ${credential}`)
      .send(body);
  const login = async (email: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);
    return res.body.accessToken as string;
  };

  beforeAll(async () => {
    ids = makeIds();
    const module = await Test.createTestingModule({
      imports: [AppModule.forRoot(authTestConfig({ databaseUrl }))],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app, { logSink: () => undefined });
    await app.init();
    prisma = app.get(PrismaService);

    const passwordHash = await bcrypt.hash(password, 4);
    await prisma.$transaction(async (tx) => {
      await tx.user.createMany({
        data: [
          {
            id: ids.main,
            email: mainEmail(),
            passwordHash,
            displayName: 'Synthetic Appearance User',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
          {
            id: ids.otherTeacher,
            email: `appearance.other.${ids.otherTeacher}@example.invalid`,
            passwordHash,
            displayName: 'Synthetic Other Teacher',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
          {
            id: ids.child,
            email: childEmail(),
            passwordHash,
            displayName: 'Synthetic Child',
            registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
          },
        ],
      });
      await tx.school.create({
        data: {
          id: ids.school,
          name: 'Appearance School',
          slug: `appearance-${ids.school}`,
          members: {
            create: {
              userId: ids.main,
              role: 'OWNER',
              state: MembershipState.ACTIVE,
            },
          },
        },
      });
      await tx.classroom.createMany({
        data: [
          { id: ids.classroomA, independentTeacherId: ids.main, name: 'Own Independent' },
          { id: ids.classroomB, independentTeacherId: ids.otherTeacher, name: 'Enrolled' },
          { id: ids.classroomC, schoolId: ids.school, name: 'School Classroom' },
          { id: ids.classroomP, independentTeacherId: ids.otherTeacher, name: 'Parent Linked' },
          { id: ids.classroomX, independentTeacherId: ids.otherTeacher, name: 'Stranger' },
        ],
      });
      await tx.classroomMembership.createMany({
        data: [
          {
            classroomId: ids.classroomB,
            userId: ids.main,
            role: ClassroomRole.STUDENT,
            state: MembershipState.ACTIVE,
          },
          {
            classroomId: ids.classroomP,
            userId: ids.child,
            role: ClassroomRole.STUDENT,
            state: MembershipState.ACTIVE,
          },
        ],
      });
      await tx.parentLink.create({
        data: {
          parentId: ids.main,
          childId: ids.child,
          classroomId: ids.classroomP,
          state: MembershipState.ACTIVE,
        },
      });
      await tx.shopItem.create({
        data: {
          id: ids.shopItem,
          code: `cap_${ids.shopItem}`,
          name: 'Appearance Cap',
          description: 'Cap',
          kind: ShopItemKind.AVATAR_ACCESSORY,
          defaultPrice: 10,
          isActive: true,
          isImplemented: true,
          metadata: { assetId: 'cap', slot: 'head' },
        },
      });
      await tx.equippedItem.create({
        data: {
          classroomId: ids.classroomB,
          studentId: ids.main,
          slot: EquippedSlot.HEAD,
          shopItemId: ids.shopItem,
        },
      });
    });

    token = await login(mainEmail());
    childToken = await login(childEmail());
  }, 20_000);

  afterAll(async () => {
    if (prisma && ids) {
      const cleanupIds = [ids.main, ids.otherTeacher, ids.child];
      await prisma.outboxEvent.deleteMany({
        where: {
          OR: [
            { payload: { path: ['userId'], equals: ids.main } },
            { payload: { path: ['userId'], equals: ids.child } },
          ],
        },
      });
      await prisma.equippedItem.deleteMany({
        where: { classroomId: ids.classroomB, studentId: ids.main },
      });
      await prisma.shopItem.deleteMany({ where: { id: ids.shopItem } });
      await prisma.parentLink.deleteMany({ where: { parentId: ids.main } });
      await prisma.classroomMembership.deleteMany({
        where: { classroomId: { in: [ids.classroomB, ids.classroomP] } },
      });
      await prisma.avatarConfiguration.deleteMany({
        where: { userId: { in: cleanupIds } },
      });
      await prisma.session.deleteMany({ where: { userId: { in: cleanupIds } } });
      await prisma.classroom.deleteMany({
        where: {
          id: {
            in: [ids.classroomA, ids.classroomB, ids.classroomC, ids.classroomP, ids.classroomX],
          },
        },
      });
      await prisma.schoolMember.deleteMany({ where: { schoolId: ids.school } });
      await prisma.school.deleteMany({ where: { id: ids.school } });
      await prisma.user.deleteMany({ where: { id: { in: cleanupIds } } });
    }
    await app?.close();
  });

  it('records one event per classroom with live access, each with that classroom snapshot', async () => {
    await patchAvatar(PATCHED).expect(200);

    const rows = await payloads(ids.main);
    // Live access in practice: own independent classroom (A), enrolled classroom (B) and the
    // school classroom owned through the Owner role (C). Parents (P) and strangers (X) never.
    expect(rows.map((row) => row.classroomId).sort()).toEqual(
      [ids.classroomA, ids.classroomB, ids.classroomC].sort(),
    );
    expect(rows).toHaveLength(3);
  });

  it('carries the patched base avatar and the classroom-scoped equipped items', async () => {
    await patchAvatar(PATCHED).expect(200);
    const rows = await payloads(ids.main);
    const byClassroom = new Map(rows.map((row) => [row.classroomId, row.appearance]));

    // The base avatar is global: every snapshot shows the just-patched avatar.
    for (const classroomId of [ids.classroomA, ids.classroomB, ids.classroomC]) {
      expect(byClassroom.get(classroomId)?.baseAvatar).toEqual(PATCHED);
    }
    // Equipped items are classroom-scoped: only B carries the equipped head item.
    expect(byClassroom.get(ids.classroomA)?.items).toEqual({
      head: null,
      face: null,
      back: null,
      desk_decor: null,
    });
    expect(byClassroom.get(ids.classroomB)?.items).toEqual({
      head: {
        slot: 'head',
        shopItemId: ids.shopItem,
        shopItemCode: `cap_${ids.shopItem}`,
        shopItemName: 'Appearance Cap',
        kind: ShopItemKind.AVATAR_ACCESSORY,
      },
      face: null,
      back: null,
      desk_decor: null,
    });
    expect(byClassroom.get(ids.classroomC)?.items).toEqual({
      head: null,
      face: null,
      back: null,
      desk_decor: null,
    });
  });

  it('records nothing for classrooms the user cannot access live', async () => {
    await patchAvatar(PATCHED).expect(200);
    const rows = await payloads(ids.main);

    // P is accessible only through the parent link (no live access) and X is a stranger.
    const classroomIds = rows.map((row) => row.classroomId);
    expect(classroomIds).not.toContain(ids.classroomP);
    expect(classroomIds).not.toContain(ids.classroomX);
    // The child is a live student of P (and of nothing else): their own patch records exactly P.
    await patchAvatar(PATCHED, childToken).expect(200);
    expect((await payloads(ids.child)).map((row) => row.classroomId)).toEqual([ids.classroomP]);
  });

  it('records nothing when the request is rejected before persistence', async () => {
    const before = (await events(ids.main)).length;

    await patchAvatar({ ...PATCHED, bodyId: 'robot' }).expect(400);

    const access = vi
      .spyOn(app.get(AvatarAccessPort), 'assertCanUse')
      .mockRejectedValueOnce(new ForbiddenException());
    try {
      await patchAvatar(PATCHED).expect(403);
    } finally {
      access.mockRestore();
    }

    expect((await events(ids.main)).length).toBe(before);
  });

  it('records a fresh snapshot for every classroom on each accepted patch', async () => {
    const before = (await events(ids.main)).length;

    await patchAvatar({ ...PATCHED, hairColor: '#E5AD58' }).expect(200);

    const rows = await payloads(ids.main);
    expect(rows).toHaveLength(before + 3);
    expect(rows.slice(-3).every((row) => row.appearance.baseAvatar.hairColor === '#E5AD58')).toBe(
      true,
    );
  });
});
