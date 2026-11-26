import { Module } from '@nestjs/common';
import type { ApiConfig } from '../../config/api-config';
import { API_CONFIG } from '../../config/config.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { OutboxModule } from '../outbox/outbox.module';
import {
  HttpRealtimeAppearanceClient,
  REALTIME_APPEARANCE_PORT,
} from './realtime-appearance.client';
import { RealtimeAppearanceHandler } from './realtime-appearance.handler';
import {
  HttpRealtimeChatBroadcastClient,
  REALTIME_CHAT_BROADCAST_PORT,
} from './realtime-chat.client';
import { RealtimeChatEventHandler } from './realtime-chat.handler';
import { HttpRealtimeEvictionClient, REALTIME_EVICTION_PORT } from './realtime-eviction.client';
import { RealtimeEvictionHandler } from './realtime-eviction.handler';
import { RealtimeEventsRecorder } from './realtime-events.recorder';
import { HttpRealtimeLayoutClient, REALTIME_LAYOUT_PORT } from './realtime-layout.client';
import { RealtimeLayoutHandler } from './realtime-layout.handler';
import {
  HttpRealtimeTutorBotSkinClient,
  REALTIME_TUTOR_BOT_SKIN_PORT,
} from './realtime-tutor-bot-skin.client';
import { RealtimeTutorBotSkinHandler } from './realtime-tutor-bot-skin.handler';

/**
 * Keeps live classroom state in step with committed changes: modules that change live access or a
 * member's appearance, a classroom's desks, tutor bot skin or its chat import it and record an event in their transaction; its
 * handlers deliver the events to the realtime server's internal routes.
 */
@Module({
  imports: [OutboxModule, PrismaModule],
  providers: [
    RealtimeEventsRecorder,
    RealtimeEvictionHandler,
    RealtimeAppearanceHandler,
    RealtimeLayoutHandler,
    RealtimeTutorBotSkinHandler,
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
      provide: REALTIME_APPEARANCE_PORT,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        new HttpRealtimeAppearanceClient({
          baseUrl: config.realtimeInternalUrl,
          serviceSecret: config.internalServiceSecret,
        }),
    },
    {
      provide: REALTIME_LAYOUT_PORT,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        new HttpRealtimeLayoutClient({
          baseUrl: config.realtimeInternalUrl,
          serviceSecret: config.internalServiceSecret,
        }),
    },
    {
      provide: REALTIME_TUTOR_BOT_SKIN_PORT,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) =>
        new HttpRealtimeTutorBotSkinClient({
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
