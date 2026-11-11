import { describe, it, expect, vi } from 'vitest';
import { ApiJoinVerifier } from './api-join-verifier';
import { JoinDeniedError } from './join-verifier';

const SECRET = 'test-only-secret-with-at-least-32-characters';
const TOKEN = 'super-secret-access-token';
const CLASSROOM_ID = '7b1f3c52-8d1e-4f0a-9a57-2c6f5e8d9a10';
const IDENTITY = {
  userId: '0b0f7c1e-1b7e-4b53-b0c4-5a1f2f6d3e01',
  sessionId: '5e2a4d7c-3f81-4e6a-8c0b-9d4a1b2c3d02',
  classroomId: CLASSROOM_ID,
  role: 'TEACHER',
  displayName: 'Ada Lovelace',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const makeVerifier = (fetchImpl: typeof fetch, timeoutMs = 3000) =>
  new ApiJoinVerifier({
    baseUrl: 'http://api.internal:3000/',
    serviceSecret: SECRET,
    timeoutMs,
    fetchImpl,
  });

describe('ApiJoinVerifier', () => {
  it('returns the verified identity on a 200 response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, IDENTITY));
    await expect(makeVerifier(fetchImpl).verify(TOKEN, CLASSROOM_ID)).resolves.toEqual(IDENTITY);
  });

  it('posts the body with the service secret header and keeps the token out of the URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, IDENTITY));
    await makeVerifier(fetchImpl).verify(TOKEN, CLASSROOM_ID);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://api.internal:3000/internal/realtime/join-verification');
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('x-internal-service-secret')).toBe(SECRET);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBeNull();
    expect(JSON.parse(init.body as string)).toEqual({
      accessToken: TOKEN,
      classroomId: CLASSROOM_ID,
    });
  });

  it.each([400, 401, 403, 404, 500, 503])('denies on a %i response', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(json(status, { message: 'nope' }));
    await expect(makeVerifier(fetchImpl).verify(TOKEN, CLASSROOM_ID)).rejects.toBeInstanceOf(
      JoinDeniedError,
    );
  });

  it('denies when the network call fails', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(makeVerifier(fetchImpl).verify(TOKEN, CLASSROOM_ID)).rejects.toBeInstanceOf(
      JoinDeniedError,
    );
  });

  it('denies and aborts the request when the API does not answer in time', async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }) as unknown as typeof fetch;

    await expect(makeVerifier(fetchImpl, 20).verify(TOKEN, CLASSROOM_ID)).rejects.toBeInstanceOf(
      JoinDeniedError,
    );
    expect(signal?.aborted).toBe(true);
  });

  it.each([
    ['a non-JSON body', new Response('<html>', { status: 200 })],
    ['an empty object', json(200, {})],
    ['a non-uuid userId', json(200, { ...IDENTITY, userId: 'x' })],
    ['an unknown role', json(200, { ...IDENTITY, role: 'ROOT' })],
    ['a parent role (no live access)', json(200, { ...IDENTITY, role: 'PARENT' })],
    ['a missing sessionId', json(200, { ...IDENTITY, sessionId: undefined })],
    ['a missing displayName', json(200, { ...IDENTITY, displayName: undefined })],
    ['an empty displayName', json(200, { ...IDENTITY, displayName: '' })],
    ['an oversized displayName', json(200, { ...IDENTITY, displayName: 'x'.repeat(101) })],
  ])('denies a 200 response with %s', async (_label, response) => {
    const fetchImpl = vi.fn().mockResolvedValue(response);
    await expect(makeVerifier(fetchImpl).verify(TOKEN, CLASSROOM_ID)).rejects.toBeInstanceOf(
      JoinDeniedError,
    );
  });

  it('denies when the API answers for a different classroom than requested', async () => {
    const other = { ...IDENTITY, classroomId: '11111111-1111-4111-8111-111111111111' };
    const fetchImpl = vi.fn().mockResolvedValue(json(200, other));
    await expect(makeVerifier(fetchImpl).verify(TOKEN, CLASSROOM_ID)).rejects.toBeInstanceOf(
      JoinDeniedError,
    );
  });

  it('never leaks the token or the secret in the denial', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error(`boom ${TOKEN} ${SECRET}`));
    const error = (await makeVerifier(fetchImpl)
      .verify(TOKEN, CLASSROOM_ID)
      .catch((e: unknown) => e)) as Error;
    expect(String(error.message)).not.toContain(TOKEN);
    expect(String(error.message)).not.toContain(SECRET);
    expect(error.cause).toBeUndefined();
  });

  describe('verification URL', () => {
    const urlFor = async (baseUrl: string): Promise<string> => {
      const fetchImpl = vi.fn().mockResolvedValue(json(200, IDENTITY));
      await new ApiJoinVerifier({ baseUrl, serviceSecret: SECRET, fetchImpl }).verify(
        TOKEN,
        CLASSROOM_ID,
      );
      return (fetchImpl.mock.calls[0] as [string])[0];
    };

    it.each([
      ['a bare origin', 'http://api:3000', 'http://api:3000/internal/realtime/join-verification'],
      [
        'a trailing slash',
        'http://api:3000/',
        'http://api:3000/internal/realtime/join-verification',
      ],
      [
        'a path prefix',
        'http://api:3000/prefix',
        'http://api:3000/prefix/internal/realtime/join-verification',
      ],
      [
        'a path prefix with a trailing slash',
        'http://api:3000/prefix/',
        'http://api:3000/prefix/internal/realtime/join-verification',
      ],
      [
        'a nested path prefix',
        'http://api:3000/a/b//',
        'http://api:3000/a/b/internal/realtime/join-verification',
      ],
    ])('keeps the base path for %s', async (_label, baseUrl, expected) => {
      await expect(urlFor(baseUrl)).resolves.toBe(expected);
    });
  });
});
