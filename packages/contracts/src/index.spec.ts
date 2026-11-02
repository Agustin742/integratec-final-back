import { describe, it, expect } from 'vitest';
import type { HealthStatus } from './index';

describe('@aula/contracts smoke test', () => {
  it('should define HealthStatus shape correctly', () => {
    const health: HealthStatus = {
      status: 'ok',
      service: 'contracts',
      timestamp: new Date().toISOString(),
    };
    expect(health.status).toBe('ok');
    expect(health.service).toBe('contracts');
  });
});
