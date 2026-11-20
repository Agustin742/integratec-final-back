import cors from 'cors';
import express, { type Application } from 'express';
import type { HealthStatus } from '@aula/contracts';
import { mountChatEventsRoute, type ChatEventsRouteOptions } from './internal/chat-events-route';
import { mountEvictionRoute, type EvictionRouteOptions } from './internal/eviction-route';

export interface ExpressOptions {
  /** Enables service-to-service routes; without it no internal route is mounted. */
  internal?: EvictionRouteOptions & ChatEventsRouteOptions;
}

export function configureExpress(app: Application, options: ExpressOptions = {}): Application {
  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    const response: HealthStatus = {
      status: 'ok',
      service: 'realtime',
      timestamp: new Date().toISOString(),
    };
    res.json(response);
  });

  if (options.internal) {
    mountEvictionRoute(app, options.internal);
    mountChatEventsRoute(app, options.internal);
  }

  return app;
}

export function createExpressApp(): Application {
  const app = express();
  return configureExpress(app);
}
