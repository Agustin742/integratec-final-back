import { Injectable, Logger } from '@nestjs/common';
import type { EmailMessage, EmailPort } from './email.port';

/**
 * Stub adapter: keeps messages in memory and performs no network call.
 * Logs only a running count, never the recipient, subject or body.
 */
@Injectable()
export class InMemoryEmailAdapter implements EmailPort {
  private readonly logger = new Logger(InMemoryEmailAdapter.name);
  private readonly messages: EmailMessage[] = [];
  // Process-local fake only; a production adapter must persist deduplication at its boundary.
  private readonly acceptedKeys = new Set<string>();

  /** Messages recorded so far (a copy; mutating it does not affect the adapter). */
  get sent(): readonly EmailMessage[] {
    return [...this.messages];
  }

  send(message: EmailMessage): Promise<void> {
    if (message.idempotencyKey !== undefined) {
      if (this.acceptedKeys.has(message.idempotencyKey)) return Promise.resolve();
      this.acceptedKeys.add(message.idempotencyKey);
    }
    this.messages.push({ ...message });
    this.logger.log({
      operation: 'email.send',
      adapter: 'in-memory',
      recorded: this.messages.length,
    });
    return Promise.resolve();
  }

  clear(): void {
    this.messages.length = 0;
    this.acceptedKeys.clear();
  }
}
