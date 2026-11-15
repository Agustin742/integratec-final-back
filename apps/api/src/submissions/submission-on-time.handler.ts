import { Injectable, type OnModuleInit } from '@nestjs/common';
import { OutboxHandlerRegistry } from '../platform/outbox/outbox.registry';
import { SUBMISSION_ON_TIME_EVENT } from './submission-events';

/**
 * Placeholder consumer for `submission.submitted-on-time`.
 *
 * The outbox dispatcher treats an event type without handlers as a failed attempt (retried with
 * backoff, then marked failed and logged as an error). The real consumer, the streak engine, lands
 * with HU-GAM-002; until then this no-op acknowledges the event so rows are not retried or
 * reported as failures. HU-GAM-002 replaces this class with its own handler. Events published
 * before that consumer exists are acknowledged, not replayed: the streak backfill must read the
 * `submissions` table (`submittedAt`, `isLate`), which stays the source of truth.
 */
@Injectable()
export class SubmissionOnTimeHandler implements OnModuleInit {
  constructor(private readonly registry: OutboxHandlerRegistry) {}

  onModuleInit(): void {
    this.registry.register(SUBMISSION_ON_TIME_EVENT, async () => undefined);
  }
}
