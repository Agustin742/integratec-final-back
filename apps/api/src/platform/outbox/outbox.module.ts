import { Module } from '@nestjs/common';
import { OutboxDispatcher } from './outbox.dispatcher';
import { OutboxHandlerRegistry } from './outbox.registry';
import { OutboxWriter } from './outbox.writer';

/**
 * Transactional outbox. Import it in a module that records events (use
 * `OutboxWriter`) or handles them (call `OutboxHandlerRegistry.register` in
 * `onModuleInit`). The dispatcher polls from the first import; relies on the
 * global `PrismaModule`.
 */
@Module({
  providers: [OutboxWriter, OutboxHandlerRegistry, OutboxDispatcher],
  exports: [OutboxWriter, OutboxHandlerRegistry],
})
export class OutboxModule {}
