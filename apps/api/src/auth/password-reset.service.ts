import { BadRequestException, Injectable } from '@nestjs/common';
import { OutboxWriter } from '../platform/outbox/outbox.writer';
import { RealtimeEventsRecorder } from '../platform/realtime/realtime-events.recorder';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordResetConfirmRequestDto } from './dto/password-reset-confirm-request.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { PasswordResetRequestedResponseDto } from './dto/password-reset-requested-response.dto';
import { hashPassword } from './password-hash';
import { PASSWORD_RESET_REQUESTED_EVENT } from './password-reset-events';
import { hashOpaqueToken } from './session-tokens';
import { lockCredentialUser } from './credential-lock';

/** Same text for every email, registered or not. */
export const PASSWORD_RESET_ACKNOWLEDGEMENT =
  'If the email belongs to an account, a reset link has been sent.';

@Injectable()
export class PasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxWriter,
    private readonly realtimeEvents: RealtimeEventsRecorder,
  ) {}

  /**
   * Asks for a reset. The answer never depends on whether the email is registered. For
   * a known user only an outbox event carrying the user id is recorded; the handler
   * creates the token and sends the email, so neither the token nor the address is ever
   * written to the outbox.
   */
  async request(dto: PasswordResetRequestDto): Promise<PasswordResetRequestedResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (user !== null) {
      await this.prisma.$transaction((tx) =>
        this.outbox.record(tx, {
          type: PASSWORD_RESET_REQUESTED_EVENT,
          payload: { userId: user.id },
        }),
      );
    }
    return { message: PASSWORD_RESET_ACKNOWLEDGEMENT };
  }

  /**
   * Spends a reset token: sets the new password, marks the token used and revokes every
   * session of the account (and so their refresh tokens), all in one transaction. An
   * unknown, used or expired token is the same generic 400. The conditional update makes
   * concurrent confirmations with one token race to a single winner.
   */
  async confirm(dto: PasswordResetConfirmRequestDto): Promise<void> {
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashOpaqueToken(dto.token) },
      select: { id: true, userId: true, usedAt: true, expiresAt: true },
    });
    if (stored === null || stored.usedAt !== null || stored.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException();
    }

    // Hashed only for a token that looked valid, so junk tokens cannot burn bcrypt time.
    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.$transaction(async (tx) => {
      // Always lock user -> reset tokens -> sessions. Login holds the same user
      // lock through session creation; concurrent reset links cannot invert it.
      await lockCredentialUser(tx, stored.userId);
      const now = new Date();
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: stored.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (count !== 1) throw new BadRequestException(); // Lost the race; nothing was written yet.

      // Other outstanding links of the account die with this one.
      await tx.passwordResetToken.updateMany({
        where: { userId: stored.userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.user.update({ where: { id: stored.userId }, data: { passwordHash } });
      const revoked = await tx.session.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      // Every live connection of the account must close with its sessions.
      if (revoked.count > 0) await this.realtimeEvents.recordAllSessionsRevoked(tx, stored.userId);
    });
  }
}
