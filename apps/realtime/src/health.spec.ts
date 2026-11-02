import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createExpressApp } from './server';

describe('Realtime health endpoint', () => {
  it('should return 200 and health status ok via Express app', async () => {
    const app = createExpressApp();

    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('realtime');
    expect(res.body.timestamp).toBeDefined();
  });
});
