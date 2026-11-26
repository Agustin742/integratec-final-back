import { describe, expect, it, vi } from 'vitest';
import type { AccessVerificationService } from '../../access/access-verification.service';
import type { SessionVerifier } from '../../auth/session-verifier.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { RealtimeAccessService } from './realtime-access.service';

const USER = '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01';
const SESSION = '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02';
const CLASSROOM = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';

/** In-memory Prisma stand-in: only the reads a join verification makes. No database. */
const makeService = (stored: { tutorBotSkin: string; tutorBotSkinRevision: number }) => {
  const prisma = {
    user: {
      findUnique: vi
        .fn()
        .mockResolvedValue({ displayName: 'Ada', appearanceRevision: 0, avatarConfig: null }),
    },
    equippedItem: { findMany: vi.fn().mockResolvedValue([]) },
    shopItem: { findMany: vi.fn().mockResolvedValue([]) },
    desk: { count: vi.fn().mockResolvedValue(12) },
    classroom: { findUniqueOrThrow: vi.fn().mockResolvedValue(stored) },
  };
  const sessions = {
    verifyToken: vi.fn().mockResolvedValue({ userId: USER, sessionId: SESSION }),
    verifySession: vi.fn().mockResolvedValue(undefined),
  };
  const access = {
    verifyClassroomAccess: vi
      .fn()
      .mockResolvedValue({ classroom: { id: CLASSROOM }, myRole: 'STUDENT' }),
  };
  const service = new RealtimeAccessService(
    sessions as unknown as SessionVerifier,
    access as unknown as AccessVerificationService,
    prisma as unknown as PrismaService,
  );
  return { service, prisma };
};

describe('RealtimeAccessService tutor bot skin (#154)', () => {
  const STORED = { tutorBotSkin: 'boca', tutorBotSkinRevision: 3 };

  it('returns the stored skin and revision of the verified classroom on join', async () => {
    const { service, prisma } = makeService(STORED);

    await expect(service.verifyJoin('token', CLASSROOM)).resolves.toMatchObject(STORED);

    expect(prisma.classroom.findUniqueOrThrow).toHaveBeenCalledExactlyOnceWith({
      where: { id: CLASSROOM },
      select: { tutorBotSkin: true, tutorBotSkinRevision: true },
    });
  });

  it('returns them on re-verification too', async () => {
    const { service } = makeService(STORED);

    await expect(service.reverify(USER, SESSION, CLASSROOM)).resolves.toMatchObject(STORED);
  });
});
