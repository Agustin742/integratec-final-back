import { randomBytes, randomUUID } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { EMAIL_PORT, type EmailPort } from '../platform/email/email.port';
import { encryptSecret } from '../platform/crypto/secret-box';
import {
  OutboxHandlerRegistry,
  type OutboxEventEnvelope,
} from '../platform/outbox/outbox.registry';
import { PrismaService } from '../prisma/prisma.service';
import {
  ClassroomInvitationCreatedHandler,
  ClassroomInvitationDeliveryError,
} from './classroom-invitation-created.handler';
import {
  CLASSROOM_INVITATION_CREATED_EVENT,
  type ClassroomInvitationCreatedPayload,
} from './classroom-invitation-events';

const TOKEN_KEY = randomBytes(32);

describe('ClassroomInvitationCreatedHandler', () => {
  let handler: ClassroomInvitationCreatedHandler;
  let mockEmail: EmailPort;
  let mockPrisma: {
    invitation: {
      findUnique: ReturnType<typeof vi.fn>;
    };
  };

  const dummyConfig: ApiConfig = {
    nodeEnv: 'test',
    port: 3000,
    databaseUrl: 'postgresql://dummy',
    accessTokenTtlSeconds: 900,
    refreshTokenTtlSeconds: 604800,
    refreshReuseGraceSeconds: 30,
    passwordResetTtlSeconds: 3600,
    passwordResetUrlBase: 'http://localhost/reset',
    invitationTtlSeconds: 604800,
    outboxPollIntervalSeconds: 5,
    outboxMaxAttempts: 5,
    realtimeInternalUrl: 'http://localhost:2567',
    internalServiceSecret: 'secret',
    jwtSecret: 'jwt-secret',
    invitationTokenKey: TOKEN_KEY,
    allowedOrigins: ['https://aula.example.edu.ar'],
    s3Bucket: 'bucket',
    s3Region: 'sa-east-1',
    s3Endpoint: undefined,
    s3ForcePathStyle: false,
    s3Credentials: undefined,
    storageSignedUrlTtlSeconds: 60,
    authDataRetentionSeconds: 2592000,
    authCleanupIntervalSeconds: 86400,
    authCleanupBatchSize: 1000,
  };

  beforeEach(async () => {
    mockEmail = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    mockPrisma = {
      invitation: {
        findUnique: vi.fn(),
      },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ClassroomInvitationCreatedHandler,
        OutboxHandlerRegistry,
        { provide: EMAIL_PORT, useValue: mockEmail },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: API_CONFIG, useValue: dummyConfig },
      ],
    }).compile();

    handler = moduleRef.get(ClassroomInvitationCreatedHandler);
  });

  it('delivers invitation email when invitation is valid and active', async () => {
    const invitationId = randomUUID();
    const classroomId = randomUUID();
    const expiresAt = new Date(Date.now() + 86400000);

    mockPrisma.invitation.findUnique.mockResolvedValue({
      id: invitationId,
      state: 'PENDING',
      expiresAt,
      classroom: { name: 'Matemática 1', deletedAt: null },
    });

    const payload: ClassroomInvitationCreatedPayload = {
      invitationId,
      classroomId,
      targetEmail: 'student@example.edu.ar',
      role: 'STUDENT',
      encryptedToken: encryptSecret('opaque-token-12345', TOKEN_KEY, invitationId),
    };

    const event: OutboxEventEnvelope = {
      id: randomUUID(),
      type: CLASSROOM_INVITATION_CREATED_EVENT,
      payload: payload as unknown as OutboxEventEnvelope['payload'],
      occurredAt: new Date(),
    };

    await handler.handle(event);

    expect(mockEmail.send).toHaveBeenCalledTimes(1);
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'student@example.edu.ar',
        subject: 'Invitation to join Matemática 1',
        text: expect.stringContaining('opaque-token-12345'),
      }),
    );
  });

  it('skips email delivery when invitation is revoked or deleted', async () => {
    const invitationId = randomUUID();

    mockPrisma.invitation.findUnique.mockResolvedValue({
      id: invitationId,
      state: 'REVOKED',
      classroom: { name: 'Matemática 1', deletedAt: null },
    });

    const event: OutboxEventEnvelope = {
      id: randomUUID(),
      type: CLASSROOM_INVITATION_CREATED_EVENT,
      payload: {
        invitationId,
        classroomId: randomUUID(),
        targetEmail: 'student@example.edu.ar',
        role: 'STUDENT',
        encryptedToken: encryptSecret('opaque-token-12345', TOKEN_KEY, invitationId),
      } as unknown as OutboxEventEnvelope['payload'],
      occurredAt: new Date(),
    };

    await handler.handle(event);

    expect(mockEmail.send).not.toHaveBeenCalled();
  });

  it('throws ClassroomInvitationDeliveryError when email sending fails', async () => {
    const invitationId = randomUUID();
    mockPrisma.invitation.findUnique.mockResolvedValue({
      id: invitationId,
      state: 'PENDING',
      expiresAt: new Date(),
      classroom: { name: 'Matemática 1', deletedAt: null },
    });

    (mockEmail.send as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('SMTP down'));

    const event: OutboxEventEnvelope = {
      id: randomUUID(),
      type: CLASSROOM_INVITATION_CREATED_EVENT,
      payload: {
        invitationId,
        classroomId: randomUUID(),
        targetEmail: 'student@example.edu.ar',
        role: 'STUDENT',
        encryptedToken: encryptSecret('opaque-token-12345', TOKEN_KEY, invitationId),
      } as unknown as OutboxEventEnvelope['payload'],
      occurredAt: new Date(),
    };

    await expect(handler.handle(event)).rejects.toBeInstanceOf(ClassroomInvitationDeliveryError);
  });

  it('fails delivery without sending when the sealed token was tampered with', async () => {
    const invitationId = randomUUID();
    mockPrisma.invitation.findUnique.mockResolvedValue({
      id: invitationId,
      state: 'PENDING',
      expiresAt: new Date(Date.now() + 86400000),
      classroom: { name: 'Matemática 1', deletedAt: null },
    });
    const sealed = encryptSecret('opaque-token-12345', TOKEN_KEY, invitationId);
    const forged = Buffer.from(sealed.ciphertext, 'base64');
    forged[0] ^= 0xff;

    const event: OutboxEventEnvelope = {
      id: randomUUID(),
      type: CLASSROOM_INVITATION_CREATED_EVENT,
      payload: {
        invitationId,
        classroomId: randomUUID(),
        targetEmail: 'student@example.edu.ar',
        role: 'STUDENT',
        encryptedToken: { ...sealed, ciphertext: forged.toString('base64') },
      } as unknown as OutboxEventEnvelope['payload'],
      occurredAt: new Date(),
    };

    await expect(handler.handle(event)).rejects.toBeInstanceOf(ClassroomInvitationDeliveryError);
    expect(mockEmail.send).not.toHaveBeenCalled();
  });

  it('ignores events that carry no sealed token', async () => {
    const event: OutboxEventEnvelope = {
      id: randomUUID(),
      type: CLASSROOM_INVITATION_CREATED_EVENT,
      payload: {
        invitationId: randomUUID(),
        classroomId: randomUUID(),
        targetEmail: 'student@example.edu.ar',
        role: 'STUDENT',
      } as unknown as OutboxEventEnvelope['payload'],
      occurredAt: new Date(),
    };

    await handler.handle(event);

    expect(mockEmail.send).not.toHaveBeenCalled();
  });
});
