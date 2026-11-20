import { Module } from '@nestjs/common';
import type { ApiConfig } from '../../config/api-config';
import { API_CONFIG } from '../../config/config.module';
import { OutboxModule } from '../outbox/outbox.module';
import { PrismaModule } from '../../prisma/prisma.module';
import {
  HttpRealtimeChatBroadcastClient,
  REALTIME_CHAT_BROADCAST_PORT,
} from './realtime-chat.client';
import { RealtimeChatEventHandler } from './realtime-chat.handler';
import { HttpRealtimeEvictionClient, REALTIME_EVICTION_PORT } from './realtime-eviction.client';
import { RealtimeEvictionHandler } from './realtime-eviction.handler';
import { RealtimeEventsRecorder } from './realtime-events.recorder';

/** Outbox-backed eviction and chat-event delivery between NestJS and Colyseus. */
@Module({
  imports: [OutboxModule, PrismaModule],
  providers: [
    RealtimeEventsRecorder,
    RealtimeEvictionHandler,
    RealtimeChatEventHandler,
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
      provide: REALTIME_CHAT_BROADCAST_PORT,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        new HttpRealtimeChatBroadcastClient({
          baseUrl: config.realtimeInternalUrl,
          serviceSecret: config.internalServiceSecret,
        }),
    },
  ],
  exports: [RealtimeEventsRecorder],
})
export class RealtimeEventsModule {}
