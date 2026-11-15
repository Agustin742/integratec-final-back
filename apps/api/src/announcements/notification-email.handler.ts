import { Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxHandlerRegistry } from '../platform/outbox/outbox.registry';
import {
  NOTIFICATION_EMAIL_REQUESTED_EVENT,
  NotificationEmailService,
} from './notification-email.service';

@Injectable()
export class NotificationEmailHandler implements OnModuleInit {
  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly email: NotificationEmailService,
  ) {}

  onModuleInit(): void {
    this.registry.register(NOTIFICATION_EMAIL_REQUESTED_EVENT, (event) =>
      this.email.deliver(event.id),
    );
  }
}
