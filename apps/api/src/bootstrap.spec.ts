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
      const res = await fetch('http://127.0.0.1:3999/health', {
        headers: { Origin: 'http://localhost:5173' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
      const other = await fetch('http://127.0.0.1:3999/health', {
        headers: { Origin: 'http://evil.example.com' },
      });
      expect(other.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await app?.close();
    }
  });
});
