import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMAIL_PORT, type EmailPort } from '../platform/email/email.port';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
export { NOTIFICATION_EMAIL_REQUESTED_EVENT } from '../notifications/notification-events';

/** Announcement-owned source lookup; notification persistence stays in its owning service. */
@Injectable()
export class NotificationEmailService {
  private readonly logger = new Logger(NotificationEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
  ) {}

  /** Asynchronous delivery; retries reuse the same provider key after uncertain outcomes. */
  async deliver(eventId: string): Promise<void> {
    const pending = await this.notifications.prepareAnnouncementEmail(eventId);
    if (!pending) return;
    const { notificationId, resourceId, to } = pending;
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
    try {
      await this.email.send({
        idempotencyKey: `notification:${notificationId}:email`,
        to,
        subject: `New announcement: ${announcement.title}`,
        text: `A new announcement was published in your classroom: ${announcement.title}. Open the application to read it.`,
      });
    } catch {
      // Never persist provider errors: they can contain recipient addresses or content.
      this.logger.warn({ operation: 'notification.email', notificationId, outcome: 'failed' });
      throw new Error('Email delivery failed');
    }
    await this.notifications.completeAnnouncementEmail(notificationId);
    this.logger.log({ operation: 'notification.email', notificationId, outcome: 'sent' });
  }
}
