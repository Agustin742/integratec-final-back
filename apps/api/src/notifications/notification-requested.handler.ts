import { Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxHandlerRegistry } from '../platform/outbox/outbox.registry';
import { NOTIFICATION_REQUESTED_EVENT } from './notification-recorder.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationRequestedHandler implements OnModuleInit {
  constructor(
    private readonly registry: OutboxHandlerRegistry,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(NOTIFICATION_REQUESTED_EVENT, (event) =>
      this.notifications.materializeCommittedEvent(event.id),
    );
  }
}
