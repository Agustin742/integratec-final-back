import { describe, it, expect } from 'vitest';
import type { HealthStatus } from '@aula/contracts';

describe('Realtime health configuration', () => {
  it('should create valid health status payload', () => {
    const healthPayload: HealthStatus = {
      status: 'ok',
      service: 'realtime',
      timestamp: new Date().toISOString(),
    };

    expect(healthPayload.status).toBe('ok');
    expect(healthPayload.service).toBe('realtime');
    expect(healthPayload.timestamp).toBeDefined();
  });
});
