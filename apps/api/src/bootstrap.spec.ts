import type { AddressInfo } from 'node:net';
import { NestApplication } from '@nestjs/core';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { start } from './bootstrap';

describe('start', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints a diagnostic naming the missing variables and exits with code 1', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.fn();

    const app = await start({}, exit);

    expect(app).toBeUndefined();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    const output = error.mock.calls.flat().join('\n');
    expect(output).toContain('DATABASE_URL');
    expect(output).toContain('INTERNAL_SERVICE_SECRET');
    expect(output).toContain('ALLOWED_ORIGINS');
  });

  it('boots the app and applies the CORS allowlist and port when valid', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    // Record the configured port, but bind an ephemeral one so the test never
    // collides with a port already in use on the machine or by a parallel worker.
    const realListen = NestApplication.prototype.listen as (
      this: NestApplication,
      port: number,
    ) => ReturnType<NestApplication['listen']>;
    const listen = vi.spyOn(NestApplication.prototype, 'listen').mockImplementation(function (
      this: NestApplication,
    ) {
      return realListen.call(this, 0);
    });
    const exit = vi.fn();
    const app = await start(
      {
        PORT: '3999',
        DATABASE_URL: 'postgresql://user:pw@localhost:5432/aula',
        INTERNAL_SERVICE_SECRET: 'test-only-secret-with-at-least-32-characters',
        ALLOWED_ORIGINS: 'http://localhost:5173',
      },
      exit,
    );
    try {
      expect(exit).not.toHaveBeenCalled();
      expect(listen).toHaveBeenCalledExactlyOnceWith(3999);
      const { port } = app!.getHttpServer().address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Origin: 'http://localhost:5173' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
      const other = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Origin: 'http://evil.example.com' },
      });
      expect(other.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-expose-headers')?.toLowerCase()).toContain(
        'x-request-id',
      );

      // The HTTP baseline (envelope + correlation id) applies to the real app.
      const missing = await fetch(`http://127.0.0.1:${port}/does-not-exist`, {
        headers: { 'x-request-id': 'bootstrap-check-1' },
      });
      expect(missing.status).toBe(404);
      expect(missing.headers.get('x-request-id')).toBe('bootstrap-check-1');
      expect(await missing.json()).toMatchObject({
        error: { code: 'NOT_FOUND', correlationId: 'bootstrap-check-1' },
      });
    } finally {
      await app?.close();
    }
  });
});
