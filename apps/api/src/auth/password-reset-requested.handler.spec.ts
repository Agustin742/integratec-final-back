import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { RegistrationPath } from '@aula/contracts';
import * as bcrypt from 'bcrypt';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiConfigModule } from '../config/config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_PORT, type EmailMessage, type EmailPort } from '../platform/email/email.port';
import type { OutboxEventEnvelope } from '../platform/outbox/outbox.registry';
import { OutboxHandlerRegistry } from '../platform/outbox/outbox.registry';
import { AuthModule } from './auth.module';
import { PASSWORD_RESET_REQUESTED_EVENT } from './password-reset-events';
import { PasswordResetRequestedHandler } from './password-reset-requested.handler';
import { hashOpaqueToken } from './session-tokens';
import { authTestConfig } from './testing/auth-test-config';

/** Email port double that can be told to fail, like a provider outage would. */
class RecordingEmailPort implements EmailPort {
  readonly sent: EmailMessage[] = [];
  failure: Error | undefined;

  send(message: EmailMessage): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    this.sent.push(message);
    return Promise.resolve();
  }
}

describe('PasswordResetRequestedHandler (idempotent outbox consumer)', () => {
  const config = authTestConfig();
  const email = `handler.${Date.now()}@example.com`;
  const mailbox = new RecordingEmailPort();
  let prisma: PrismaService;
  let handler: PasswordResetRequestedHandler;
  let registry: OutboxHandlerRegistry;
  let close: () => Promise<void>;
  let userId: string;

  const eventFor = (payload: unknown, id = randomUUID()): OutboxEventEnvelope => ({
    id,
    type: PASSWORD_RESET_REQUESTED_EVENT,
    payload: payload as OutboxEventEnvelope['payload'],
    occurredAt: new Date(),
  });

  const rawTokenOf = (message: EmailMessage): string =>
    (/[?&]token=([A-Za-z0-9_-]+)/.exec(message.text) as RegExpExecArray)[1];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config), PrismaModule, AuthModule],
    })
      .overrideProvider(EMAIL_PORT)
      .useValue(mailbox)
      .compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    handler = moduleRef.get(PasswordResetRequestedHandler);
    registry = moduleRef.get(OutboxHandlerRegistry, { strict: false });
    close = () => moduleRef.close();

    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash('correctHorseBattery1', 4),
        displayName: 'Handler Tester',
        registrationPath: RegistrationPath.INDEPENDENT_TEACHER,
      },
    });
    userId = user.id;
  });

  beforeEach(async () => {
    mailbox.sent.length = 0;
    mailbox.failure = undefined;
    await prisma.passwordResetToken.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma?.user.deleteMany({ where: { id: userId } });
    await close?.();
  });

  it('is registered for the password-reset-requested event type', () => {
    expect(registry.handlersFor(PASSWORD_RESET_REQUESTED_EVENT).length).toBeGreaterThan(0);
  });

  it('creates the token and sends one email', async () => {
    await handler.handle(eventFor({ userId }));

    expect(mailbox.sent).toHaveLength(1);
    expect(mailbox.sent[0].to).toBe(email);
    const token = rawTokenOf(mailbox.sent[0]);
    expect(mailbox.sent[0].text).toContain(`${config.passwordResetUrlBase}?token=${token}`);
    const rows = await prisma.passwordResetToken.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashOpaqueToken(token));
  });

  it('does not send a second email nor create a second token when the event is redelivered', async () => {
    const event = eventFor({ userId });

    await handler.handle(event);
    await handler.handle(event);
    await handler.handle(event);

    expect(mailbox.sent).toHaveLength(1);
    expect(await prisma.passwordResetToken.count({ where: { userId } })).toBe(1);
  });

  it('treats distinct events as distinct requests', async () => {
    await handler.handle(eventFor({ userId }));
    await handler.handle(eventFor({ userId }));

    expect(mailbox.sent).toHaveLength(2);
    expect(await prisma.passwordResetToken.count({ where: { userId } })).toBe(2);
  });

  it('retries cleanly after a send failure: one usable token, one delivered email', async () => {
    const event = eventFor({ userId });
    mailbox.failure = new Error(`provider rejected recipient ${email}`);

    const failure = await handler.handle(event).catch((error: unknown) => error as Error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain(email);
    expect((failure as Error).message).not.toContain('token');
    expect(mailbox.sent).toHaveLength(0);

    mailbox.failure = undefined;
    await handler.handle(event);
    await handler.handle(event);

    expect(mailbox.sent).toHaveLength(1);
    const rows = await prisma.passwordResetToken.findMany({ where: { userId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashOpaqueToken(rawTokenOf(mailbox.sent[0])));
  });

  it('does nothing for a user that no longer exists', async () => {
    await handler.handle(eventFor({ userId: randomUUID() }));

    expect(mailbox.sent).toHaveLength(0);
  });

  it.each([[null], [{}], [{ userId: 5 }], [{ userId: 'not-a-uuid' }], ['text']])(
    'fails without leaking details on a malformed payload %j',
    async (payload) => {
      await expect(handler.handle(eventFor(payload))).rejects.toThrow(Error);
      expect(mailbox.sent).toHaveLength(0);
    },
  );
});
