import config from '@colyseus/tools';
import cors from 'cors';
import express from 'express';
import type { HealthStatus } from '@aula/contracts';

export default config({
  initializeExpress: (app) => {
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
  },
  initializeGameServer: (_gameServer) => {
    // Rooms will be registered in future milestones (HU-ESP-001)
  },
});
