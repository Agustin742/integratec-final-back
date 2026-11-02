import cors from 'cors';
import express, { type Application } from 'express';
import type { HealthStatus } from '@aula/contracts';

export function configureExpress(app: Application): Application {
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

  return app;
}

export function createExpressApp(): Application {
  const app = express();
  return configureExpress(app);
}

