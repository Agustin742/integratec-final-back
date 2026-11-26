import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMAIL_PORT, type EmailPort } from '../platform/email/email.port';
import { PrismaService } from '../prisma/prisma.service';
import type { ApiConfig } from '../config/api-config';
import { API_CONFIG } from '../config/config.module';
import { NotificationsService } from '../notifications/notifications.service';
export { NOTIFICATION_EMAIL_REQUESTED_EVENT } from '../notifications/notification-events';

/** Shared email delivery; announcement source lookup stays in its owning module. */
@Injectable()
export class NotificationEmailService {
  private readonly logger = new Logger(NotificationEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  /** Asynchronous delivery; retries reuse the same provider key after uncertain outcomes. */
  async deliver(eventId: string): Promise<void> {
    const pending = await this.notifications.prepareNotificationEmail(eventId);
    if (!pending) return;
    const { notificationId, resourceId, to, kind } = pending;
    let subject: string;
    let text: string;
    if (kind === 'grade_posted') {
      // Link to the configured application origin, never put child/grade details in mail.
      const applicationUrl = new URL('/', this.config.invitationAcceptUrlBase).href;
      subject = 'Nueva calificación disponible';
      text = `Hay una nueva calificación disponible. Ingresá a la aplicación para consultarla: ${applicationUrl}`;
    } else {
      const announcement = await this.prisma.announcement.findFirst({
        where: { id: resourceId, deletedAt: null },
        select: { title: true },
      });
      if (!announcement) {
        this.logger.log({
          operation: 'notification.email',
          notificationId,
          outcome: 'skipped_resource_removed',
        });
        return;
      }
      subject = `New announcement: ${announcement.title}`;
      text = `A new announcement was published in your classroom: ${announcement.title}. Open the application to read it.`;
    }
    try {
      await this.email.send({
        idempotencyKey: `notification:${notificationId}:email`,
        to,
        subject,
        text,
      });
    } catch {
      // Never persist provider errors: they can contain recipient addresses or content.
      this.logger.warn({ operation: 'notification.email', notificationId, outcome: 'failed' });
      throw new Error('Email delivery failed');
    }
    await this.notifications.completeNotificationEmail(notificationId);
    this.logger.log({ operation: 'notification.email', notificationId, outcome: 'sent' });
  }
}
