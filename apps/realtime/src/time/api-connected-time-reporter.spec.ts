import { describe, expect, it, vi } from 'vitest';
import { ApiConnectedTimeReporter } from './api-connected-time-reporter';

const SECRET = 'test-only-secret-with-at-least-32-characters';
const ENTRY = {
  userId: '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01',
  classroomId: '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10',
  connectedSeconds: 125,
  endedAt: '2026-11-10T20:30:00.000Z',
};

const make = (fetchImpl: typeof fetch, timeoutMs = 3000) =>
  new ApiConnectedTimeReporter({
    baseUrl: 'http://api.internal:3000/',
    serviceSecret: SECRET,
    timeoutMs,
    fetchImpl,
  });

describe('ApiConnectedTimeReporter', () => {
  it('posts one aggregate with the service secret', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await make(fetchImpl).report(ENTRY);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.internal:3000/internal/realtime/connected-time');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('x-internal-service-secret')).toBe(SECRET);
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(ENTRY);
  });

  it.each([400, 401, 404, 500, 503])('rejects on a %i response', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status }));
    await expect(make(fetchImpl).report(ENTRY)).rejects.toThrow('Connected time report failed');
  });

  it('rejects when the network call fails, without echoing the cause', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError(`boom ${SECRET}`));
    const error = (await make(fetchImpl)
      .report(ENTRY)
      .catch((e: unknown) => e)) as Error;

    expect(error.message).toBe('Connected time report failed');
    expect(error.message).not.toContain(SECRET);
    expect(error.cause).toBeUndefined();
  });

  it('aborts the request when the API does not answer in time', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }) as unknown as typeof fetch;

    await expect(make(fetchImpl, 20).report(ENTRY)).rejects.toThrow('Connected time report failed');
    expect(signal?.aborted).toBe(true);
  });
});
