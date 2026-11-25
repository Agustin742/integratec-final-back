import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { InvitationRole } from '@prisma/client';
import type { ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { decryptSecret } from '../platform/crypto/secret-box';
import { EMAIL_PORT, type EmailPort } from '../platform/email/email.port';
import { escapeHtml } from '../platform/email/escape-html';
import {
  OutboxHandlerRegistry,
  type OutboxEventEnvelope,
} from '../platform/outbox/outbox.registry';
import { PrismaService } from '../prisma/prisma.service';
import {
  CLASSROOM_INVITATION_CREATED_EVENT,
  type ClassroomInvitationCreatedPayload,
} from './classroom-invitation-events';

export class ClassroomInvitationDeliveryError extends Error {
  constructor() {
    super('Classroom invitation email delivery failed');
    this.name = 'ClassroomInvitationDeliveryError';
  }
}

/**
 * Handles `classroom.invitation-created` outbox events asynchronously and delivers
 * the invitation link via the configured EmailPort.
 */
@Injectable()
export class ClassroomInvitationCreatedHandler implements OnModuleInit {
  private readonly logger = new Logger(ClassroomInvitationCreatedHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: OutboxHandlerRegistry,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  onModuleInit(): void {
    this.registry.register(CLASSROOM_INVITATION_CREATED_EVENT, (event) => this.handle(event));
  }

  async handle(event: OutboxEventEnvelope): Promise<void> {
    const payload = event.payload as unknown as ClassroomInvitationCreatedPayload;
    if (!payload?.invitationId || !payload?.targetEmail || !payload?.encryptedToken) {
      return;
    }

    try {
      const invitation = await this.prisma.invitation.findUnique({
        where: { id: payload.invitationId },
        include: { classroom: { select: { name: true, deletedAt: true, adultMode: true } } },
      });

      if (!invitation || invitation.state === 'REVOKED' || invitation.classroom?.deletedAt) {
        return; // Canceled, revoked, or classroom deleted
      }

      const isParentInvitation =
        invitation.role === InvitationRole.PARENT || payload.role === InvitationRole.PARENT;

      if (isParentInvitation && invitation.classroom?.adultMode) {
        return; // Parent invitations are disabled in adult education mode
      }

      // Decrypt only now, right before delivery; throws if the payload was tampered with.
      const token = decryptSecret(
        payload.encryptedToken,
        this.config.invitationTokenKey,
        payload.invitationId,
      );

      const classroomName = invitation.classroom?.name ?? 'Virtual Classroom';
      const acceptUrl = `${this.config.invitationAcceptUrlBase}?token=${token}`;
      const expiresAtIso = invitation.expiresAt.toISOString();

      const subject = isParentInvitation
        ? `Guardian invitation for ${classroomName}`
        : `Invitation to join ${classroomName}`;
      const text = isParentInvitation
        ? `You have been invited as a parent or guardian to follow a student's progress in the virtual classroom "${classroomName}". Use the following link to accept the invitation:\n\n${acceptUrl}\n\nThis link will expire on ${expiresAtIso}.`
        : `You have been invited to join the virtual classroom "${classroomName}". Use the following link to accept the invitation:\n\n${acceptUrl}\n\nThis link will expire on ${expiresAtIso}.`;
      const html = isParentInvitation
        ? [
            `<p>You have been invited as a parent or guardian to follow a student's progress in the virtual classroom <strong>${escapeHtml(classroomName)}</strong>.</p>`,
            `<p><a href="${escapeHtml(acceptUrl)}">Accept the invitation</a></p>`,
            `<p>This link will expire on ${escapeHtml(expiresAtIso)}.</p>`,
          ].join('\n')
        : [
            `<p>You have been invited to join the virtual classroom <strong>${escapeHtml(classroomName)}</strong>.</p>`,
            `<p><a href="${escapeHtml(acceptUrl)}">Accept the invitation</a></p>`,
            `<p>This link will expire on ${escapeHtml(expiresAtIso)}.</p>`,
          ].join('\n');

      await this.email.send({
        to: payload.targetEmail,
        subject,
        text,
        html,
        idempotencyKey: `classroom-invitation:${event.id}`,
      });
    } catch (error) {
      this.logger.warn({
        operation: 'classrooms.invitation.deliver',
        eventId: event.id,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
      throw new ClassroomInvitationDeliveryError();
    }
  }
}
