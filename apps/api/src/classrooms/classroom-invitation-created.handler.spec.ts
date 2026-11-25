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
    passwordResetUrlBase: 'https://invite-frontend.example.edu.ar/password-reset',
    invitationAcceptUrlBase: 'https://invite-frontend.example.edu.ar/invitations/accept',
    invitationTtlSeconds: 604800,
    outboxPollIntervalSeconds: 5,
    outboxMaxAttempts: 5,
    realtimeInternalUrl: 'http://localhost:2567',
    internalServiceSecret: 'secret',
    jwtSecret: 'jwt-secret',
    invitationTokenKey: TOKEN_KEY,
    allowedOrigins: ['https://cors-only.example.edu.ar'],
    s3Bucket: 'bucket',
    s3Region: 'sa-east-1',
    s3Endpoint: undefined,
    s3ForcePathStyle: false,
    s3Credentials: undefined,
    storageSignedUrlTtlSeconds: 60,
    authDataRetentionSeconds: 2592000,
    authCleanupIntervalSeconds: 86400,
    authCleanupBatchSize: 1000,
    gradeWeightTp: 1,
    gradeWeightExam: 1.5,
    emailProvider: 'smtp',
    smtpHost: 'localhost',
    smtpPort: 1025,
    smtpSecure: false,
    smtpAuth: undefined,
    emailFrom: 'soporte@fundacion-integrar.org.ar',
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

    const expectedUrl =
      'https://invite-frontend.example.edu.ar/invitations/accept?token=opaque-token-12345';
    expect(mockEmail.send).toHaveBeenCalledTimes(1);
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'student@example.edu.ar',
        subject: 'Invitation to join Matemática 1',
        text: expect.stringContaining(expectedUrl),
        html: expect.stringContaining(`href="${expectedUrl}"`),
        idempotencyKey: `classroom-invitation:${event.id}`,
      }),
    );
    const sent = (mockEmail.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      text: string;
      html: string;
    };
    expect(sent.text).not.toContain('https://cors-only.example.edu.ar');
    expect(sent.html).not.toContain('https://cors-only.example.edu.ar');
  });

  it('escapes HTML special characters in classroom name inside invitation HTML body', async () => {
    const invitationId = randomUUID();
    const classroomId = randomUUID();
    mockPrisma.invitation.findUnique.mockResolvedValue({
      id: invitationId,
      state: 'PENDING',
      expiresAt: new Date('2026-12-01T12:00:00.000Z'),
      classroom: { name: '<script>alert(1)</script> & "5to"', deletedAt: null },
    });

    const event: OutboxEventEnvelope = {
      id: randomUUID(),
      type: CLASSROOM_INVITATION_CREATED_EVENT,
      payload: {
        invitationId,
        classroomId,
        targetEmail: 'student@example.edu.ar',
        role: 'STUDENT',
        encryptedToken: encryptSecret('opaque-token-xss', TOKEN_KEY, invitationId),
      } as unknown as OutboxEventEnvelope['payload'],
      occurredAt: new Date(),
    };

    await handler.handle(event);

    const sent = (mockEmail.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as { html: string };
    expect(sent.html).not.toContain('<script>');
    expect(sent.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;5to&quot;');
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

  it('renders guardian invitation copy for PARENT invitations without leaking student PII', async () => {
    const invitationId = randomUUID();
    const classroomId = randomUUID();
    const expiresAt = new Date('2026-12-01T12:00:00.000Z');

    mockPrisma.invitation.findUnique.mockResolvedValue({
      id: invitationId,
      role: 'PARENT',
      state: 'PENDING',
      expiresAt,
      classroom: { name: 'Biología 2', deletedAt: null, adultMode: false },
    });

    const event: OutboxEventEnvelope = {
      id: randomUUID(),
      type: CLASSROOM_INVITATION_CREATED_EVENT,
      payload: {
        invitationId,
        classroomId,
        targetEmail: 'guardian@example.edu.ar',
        role: 'PARENT',
        encryptedToken: encryptSecret('parent-token-999', TOKEN_KEY, invitationId),
      } as unknown as OutboxEventEnvelope['payload'],
      occurredAt: new Date(),
    };

    await handler.handle(event);

    const expectedUrl =
      'https://invite-frontend.example.edu.ar/invitations/accept?token=parent-token-999';
    expect(mockEmail.send).toHaveBeenCalledTimes(1);
    expect(mockEmail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'guardian@example.edu.ar',
        subject: 'Guardian invitation for Biología 2',
        text: expect.stringContaining('parent or guardian'),
        html: expect.stringContaining(`href="${expectedUrl}"`),
      }),
    );
  });

  it('skips PARENT invitation email delivery when adultMode was enabled', async () => {
    const invitationId = randomUUID();
    mockPrisma.invitation.findUnique.mockResolvedValue({
      id: invitationId,
      role: 'PARENT',
      state: 'PENDING',
      expiresAt: new Date(Date.now() + 86400000),
      classroom: { name: 'Adultos 1', deletedAt: null, adultMode: true },
    });

    const event: OutboxEventEnvelope = {
      id: randomUUID(),
      type: CLASSROOM_INVITATION_CREATED_EVENT,
      payload: {
        invitationId,
        classroomId: randomUUID(),
        targetEmail: 'guardian@example.edu.ar',
        role: 'PARENT',
        encryptedToken: encryptSecret('parent-token-adult', TOKEN_KEY, invitationId),
      } as unknown as OutboxEventEnvelope['payload'],
      occurredAt: new Date(),
    };

    await handler.handle(event);

    expect(mockEmail.send).not.toHaveBeenCalled();
  });
});
