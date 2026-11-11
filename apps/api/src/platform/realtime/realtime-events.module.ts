import { Module } from '@nestjs/common';
import type { ApiConfig } from '../../config/api-config';
import { API_CONFIG } from '../../config/config.module';
import { OutboxModule } from '../outbox/outbox.module';
import { HttpRealtimeEvictionClient, REALTIME_EVICTION_PORT } from './realtime-eviction.client';
import { RealtimeEvictionHandler } from './realtime-eviction.handler';
import { RealtimeEventsRecorder } from './realtime-events.recorder';

/**
 * Evicts users from live classrooms when they lose access: modules that revoke access import it
 * and record an event in their transaction; its handler delivers the event to the realtime server.
 */
@Module({
  imports: [OutboxModule],
  providers: [
    RealtimeEventsRecorder,
    RealtimeEvictionHandler,
    {
      provide: REALTIME_EVICTION_PORT,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        new HttpRealtimeEvictionClient({
          baseUrl: config.realtimeInternalUrl,
          serviceSecret: config.internalServiceSecret,
        }),
    },
  ],
  exports: [RealtimeEventsRecorder],
})
export class RealtimeEventsModule {}
