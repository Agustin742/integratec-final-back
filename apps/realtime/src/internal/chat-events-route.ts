import type { Application } from 'express';
import { chatRealtimeBroadcastSchema, type ChatRealtimeBroadcast } from '@aula/contracts';
import { hasValidServiceSecret } from './service-auth';

export const CHAT_EVENTS_PATH = '/internal/chat-events';

export interface ChatEventsRouteOptions {
  serviceSecret: string;
  directory: { broadcastChatEvent(event: ChatRealtimeBroadcast): void };
}

/** Mounts the authenticated NestJS-only endpoint that broadcasts committed chat events. */
export function mountChatEventsRoute(app: Application, options: ChatEventsRouteOptions): void {
  app.post(CHAT_EVENTS_PATH, (req, res) => {
    if (!hasValidServiceSecret(req, options.serviceSecret)) {
      res.sendStatus(401);
      return;
    }
    const parsed = chatRealtimeBroadcastSchema.safeParse(req.body);
    if (!parsed.success) {
      res.sendStatus(400);
      return;
    }
    options.directory.broadcastChatEvent(parsed.data);
    res.sendStatus(204);
  });
}
