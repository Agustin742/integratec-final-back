import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { EMAIL_PORT, type EmailPort } from '../platform/email/email.port';
import {
  OutboxHandlerRegistry,
  type OutboxEventEnvelope,
} from '../platform/outbox/outbox.registry';
import { PrismaService } from '../prisma/prisma.service';
import { PASSWORD_RESET_REQUESTED_EVENT } from './password-reset-events';
import { generateOpaqueToken, hashOpaqueToken } from './session-tokens';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deliberately generic: the outbox stores handler error messages, and neither the
 * recipient, the token nor provider details may end up in that table.
 */
export class PasswordResetDeliveryError extends Error {
  constructor() {
    super('password reset delivery failed');
    this.name = 'PasswordResetDeliveryError';
  }
}

/**
 * Turns an `auth.password-reset-requested` event into a stored token and an email.
 *
 * Delivery is at-least-once, so the handler is idempotent on `event.id`: the token row
 * carries it as `sourceEventId` (unique) and `sentAt` marks a completed delivery. A
 * redelivery after success does nothing. A redelivery after a failed send reuses the
 * same row with a fresh token, because the raw value of the first one is gone (only its
 * hash was stored) and never reached the user. The one gap left is a crash between the
 * send and the `sentAt` write, which can send a second email with a second valid token;
 * that is the usual at-least-once trade-off.
 */
@Injectable()
export class PasswordResetRequestedHandler implements OnModuleInit {
  private readonly logger = new Logger(PasswordResetRequestedHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: OutboxHandlerRegistry,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  onModuleInit(): void {
    this.registry.register(PASSWORD_RESET_REQUESTED_EVENT, (event) => this.handle(event));
  }

  async handle(event: OutboxEventEnvelope): Promise<void> {
    const userId = userIdOf(event.payload);
    try {
      await this.deliver(event.id, userId);
    } catch (error) {
      // Log the class only: provider and database errors can echo the recipient or query data.
      this.logger.warn({
        operation: 'auth.password-reset.deliver',
        eventId: event.id,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      throw new PasswordResetDeliveryError();
    }
  }

  private async deliver(eventId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (user === null) return; // The account is gone; there is nobody to notify.

    const existing = await this.prisma.passwordResetToken.findUnique({
      where: { sourceEventId: eventId },
      select: { id: true, sentAt: true },
    });
    if (existing?.sentAt) return;

    const token = generateOpaqueToken();
    const data = {
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date(Date.now() + this.config.passwordResetTtlSeconds * 1000),
    };
    const row = existing
      ? await this.prisma.passwordResetToken.update({
          where: { id: existing.id },
          data,
          select: { id: true },
        })
      : await this.prisma.passwordResetToken.create({
          data: { ...data, userId, sourceEventId: eventId },
          select: { id: true },
        });

    await this.email.send({
      to: user.email,
      subject: 'Reset your password',
      text: this.messageText(token),
    });
    await this.prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { sentAt: new Date() },
    });
  }

  /** The link carries the raw token as `?token=`; see `PASSWORD_RESET_URL_BASE`. */
  private messageText(token: string): string {
    const link = `${this.config.passwordResetUrlBase}?token=${token}`;
    return [
      'We received a request to reset your password.',
      `Open this link within ${describeDuration(this.config.passwordResetTtlSeconds)} to choose a new one:`,
      '',
      link,
      '',
      'If you did not ask for this, ignore this email: your password stays the same.',
    ].join('\n');
  }
}

function userIdOf(payload: Prisma.JsonValue): string {
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const { userId } = payload;
    if (typeof userId === 'string' && UUID.test(userId)) return userId;
  }
  throw new PasswordResetDeliveryError();
}

function describeDuration(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
