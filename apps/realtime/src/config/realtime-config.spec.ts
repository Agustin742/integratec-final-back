import { describe, it, expect } from 'vitest';
import { ConfigValidationError, loadRealtimeConfig } from './realtime-config';

const SECRET = 's3cr3t-value-that-is-at-least-32-chars-long!';

const validEnv = (): Record<string, string | undefined> => ({
  API_INTERNAL_URL: 'http://localhost:3000',
  INTERNAL_SERVICE_SECRET: SECRET,
});

const messageOf = (env: Record<string, string | undefined>): string => {
  try {
    loadRealtimeConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return (error as ConfigValidationError).message;
  }
  throw new Error('expected loadRealtimeConfig to throw');
};

describe('loadRealtimeConfig', () => {
  it('returns a typed config with defaults applied', () => {
    expect(loadRealtimeConfig(validEnv())).toEqual({
      nodeEnv: 'development',
      port: 2567,
      apiInternalUrl: 'http://localhost:3000',
      internalServiceSecret: SECRET,
      reconnectionWindowSeconds: 20,
    });
  });

  describe('RECONNECTION_WINDOW_SECONDS', () => {
    it('parses an explicit window', () => {
      expect(
        loadRealtimeConfig({ ...validEnv(), RECONNECTION_WINDOW_SECONDS: '45' }),
      ).toMatchObject({ reconnectionWindowSeconds: 45 });
    });

    it.each(['0', '121', '-5', '1.5', 'abc', '20s'])('rejects %j by name', (value) => {
      const message = messageOf({ ...validEnv(), RECONNECTION_WINDOW_SECONDS: value });
      expect(message).toContain('RECONNECTION_WINDOW_SECONDS');
      expect(message).toContain('between 1 and 120');
    });

    it('treats a blank value as unset', () => {
      expect(loadRealtimeConfig({ ...validEnv(), RECONNECTION_WINDOW_SECONDS: ' ' })).toMatchObject(
        { reconnectionWindowSeconds: 20 },
      );
    });
  });

  it('parses explicit values', () => {
    expect(
      loadRealtimeConfig({
        ...validEnv(),
        NODE_ENV: 'production',
        PORT: '4000',
        API_INTERNAL_URL: 'https://api.internal.example.com/base',
      }),
    ).toMatchObject({
      nodeEnv: 'production',
      port: 4000,
      apiInternalUrl: 'https://api.internal.example.com/base',
    });
  });

  it.each(['API_INTERNAL_URL', 'INTERNAL_SERVICE_SECRET'])('names %s when missing', (name) => {
    const env = validEnv();
    delete env[name];
    const message = messageOf(env);
    expect(message).toContain(name);
    expect(message).toContain('required');
  });

  it('reports every problem together', () => {
    const message = messageOf({ PORT: 'abc' });
    for (const name of ['API_INTERNAL_URL', 'INTERNAL_SERVICE_SECRET', 'PORT']) {
      expect(message).toContain(name);
    }
  });

  it.each(['abc', '0', '65536', '25.5'])('rejects PORT=%s', (port) => {
    expect(messageOf({ ...validEnv(), PORT: port })).toContain('PORT');
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(messageOf({ ...validEnv(), NODE_ENV: 'staging' })).toContain('NODE_ENV');
  });

  it.each(['localhost:3000', 'ftp://api.example.com', 'not a url', '/relative'])(
    'rejects API_INTERNAL_URL=%s',
    (url) => {
      expect(messageOf({ ...validEnv(), API_INTERNAL_URL: url })).toContain('API_INTERNAL_URL');
    },
  );

  it('rejects a short INTERNAL_SERVICE_SECRET without echoing it', () => {
    const message = messageOf({ ...validEnv(), INTERNAL_SERVICE_SECRET: 'hunter2-short' });
    expect(message).toContain('INTERNAL_SERVICE_SECRET');
    expect(message).toContain('32');
    expect(message).not.toContain('hunter2-short');
  });
});
