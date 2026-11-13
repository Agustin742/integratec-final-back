import cors from 'cors';
import express, { type Application } from 'express';
import type { HealthStatus } from '@aula/contracts';
import { mountEvictionRoute, type EvictionRouteOptions } from './internal/eviction-route';

export interface ExpressOptions {
  /** Enables the internal eviction route; without it the route does not exist. */
  internal?: EvictionRouteOptions;
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

  if (options.internal) mountEvictionRoute(app, options.internal);

  return app;
}

export function createExpressApp(): Application {
  const app = express();
  return configureExpress(app);
}
