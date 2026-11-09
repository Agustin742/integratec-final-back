import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { EMAIL_PORT, type EmailPort } from '../platform/email/email.port';
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
    if (!payload?.invitationId || !payload?.targetEmail || !payload?.token) {
      return;
    }

    try {
      const invitation = await this.prisma.invitation.findUnique({
        where: { id: payload.invitationId },
        include: { classroom: { select: { name: true, deletedAt: true } } },
      });

      if (!invitation || invitation.state === 'REVOKED' || invitation.classroom?.deletedAt) {
        return; // Canceled, revoked, or classroom deleted
      }

      const classroomName = invitation.classroom?.name ?? 'Virtual Classroom';
      const baseUrl = this.config.allowedOrigins[0] || 'http://localhost:3000';
      const acceptUrl = `${baseUrl}/invitations/accept?token=${payload.token}`;

      await this.email.send({
        to: payload.targetEmail,
        subject: `Invitation to join ${classroomName}`,
        text: `You have been invited to join the virtual classroom "${classroomName}". Use the following link to accept the invitation:\n\n${acceptUrl}\n\nThis link will expire on ${invitation.expiresAt.toISOString()}.`,
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
