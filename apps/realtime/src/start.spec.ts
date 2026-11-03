import { describe, it, expect, vi, afterEach } from 'vitest';
import { start } from './start';

describe('start', () => {
  afterEach(() => vi.restoreAllMocks());

  it('prints a diagnostic naming the missing variables and exits with code 1', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = vi.fn();
    const listen = vi.fn();

    start({}, exit, listen);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(listen).not.toHaveBeenCalled();
    const output = error.mock.calls.flat().join('\n');
    expect(output).toContain('API_INTERNAL_URL');
    expect(output).toContain('INTERNAL_SERVICE_SECRET');
  });

  it('listens on the configured port when the environment is valid', () => {
    const exit = vi.fn();
    const listen = vi.fn();

    start(
      {
        PORT: '2999',
        API_INTERNAL_URL: 'http://localhost:3000',
        INTERNAL_SERVICE_SECRET: 'test-only-secret-with-at-least-32-characters',
      },
      exit,
      listen,
    );

    expect(exit).not.toHaveBeenCalled();
    expect(listen).toHaveBeenCalledExactlyOnceWith(2999);
  });
});
