import { Module } from '@nestjs/common';
import type { ApiConfig } from '../../config/api-config';
import { API_CONFIG } from '../../config/config.module';
import { OutboxModule } from '../outbox/outbox.module';
import {
  HttpRealtimeAppearanceClient,
  REALTIME_APPEARANCE_PORT,
} from './realtime-appearance.client';
import { RealtimeAppearanceHandler } from './realtime-appearance.handler';
import { HttpRealtimeEvictionClient, REALTIME_EVICTION_PORT } from './realtime-eviction.client';
import { RealtimeEvictionHandler } from './realtime-eviction.handler';
import { RealtimeEventsRecorder } from './realtime-events.recorder';

/**
 * Keeps live classroom state in step with committed changes: modules that change live access or a
 * member's appearance import it and record an event in their transaction; its handlers deliver
 * the events to the realtime server's internal routes.
 */
@Module({
  imports: [OutboxModule],
  providers: [
    RealtimeEventsRecorder,
    RealtimeEvictionHandler,
    RealtimeAppearanceHandler,
    {
      provide: REALTIME_EVICTION_PORT,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        new HttpRealtimeEvictionClient({
          baseUrl: config.realtimeInternalUrl,
          serviceSecret: config.internalServiceSecret,
        }),
    },
    {
      provide: REALTIME_APPEARANCE_PORT,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        new HttpRealtimeAppearanceClient({
          baseUrl: config.realtimeInternalUrl,
          serviceSecret: config.internalServiceSecret,
        }),
    },
  ],
  exports: [RealtimeEventsRecorder],
})
export class RealtimeEventsModule {}
