import { describe, it, expect } from 'vitest';
import { ConfigValidationError, loadApiConfig } from './api-config';

const SECRET = 's3cr3t-value-that-is-at-least-32-chars-long!';

const validEnv = (): Record<string, string | undefined> => ({
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/aula?schema=public',
  INTERNAL_SERVICE_SECRET: SECRET,
  ALLOWED_ORIGINS: 'http://localhost:5173',
});

const messageOf = (env: Record<string, string | undefined>): string => {
  try {
    loadApiConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return (error as ConfigValidationError).message;
  }
  throw new Error('expected loadApiConfig to throw');
};

describe('loadApiConfig', () => {
  it('returns a typed config with defaults applied', () => {
    expect(loadApiConfig(validEnv())).toEqual({
      nodeEnv: 'development',
      port: 3000,
      databaseUrl: 'postgresql://user:pw@localhost:5432/aula?schema=public',
      accessTokenTtlSeconds: 900,
      refreshTokenTtlSeconds: 604800,
      invitationTtlSeconds: 604800,
      internalServiceSecret: SECRET,
      allowedOrigins: ['http://localhost:5173'],
    });
  });

  it('parses explicit values', () => {
    const config = loadApiConfig({
      ...validEnv(),
      NODE_ENV: 'production',
      PORT: '8080',
      DATABASE_URL: 'postgres://db.internal/aula',
      JWT_ACCESS_TTL: '30s',
      REFRESH_TOKEN_TTL: '2h',
      INVITATION_TTL: '3d',
      ALLOWED_ORIGINS: ' https://a.example.com , https://b.example.com:8443 ',
    });
    expect(config).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      accessTokenTtlSeconds: 30,
      refreshTokenTtlSeconds: 7200,
      invitationTtlSeconds: 259200,
      allowedOrigins: ['https://a.example.com', 'https://b.example.com:8443'],
    });
  });

  it.each(['DATABASE_URL', 'INTERNAL_SERVICE_SECRET', 'ALLOWED_ORIGINS'])(
    'names %s when it is missing',
    (name) => {
      const env = validEnv();
      delete env[name];
      const message = messageOf(env);
      expect(message).toContain(name);
      expect(message).toContain('required');
    },
  );

  it('treats blank values as missing', () => {
    expect(messageOf({ ...validEnv(), DATABASE_URL: '   ' })).toContain('DATABASE_URL');
  });

  it('reports every problem together', () => {
    const message = messageOf({});
    for (const name of ['DATABASE_URL', 'INTERNAL_SERVICE_SECRET', 'ALLOWED_ORIGINS']) {
      expect(message).toContain(name);
    }
  });

  it('exposes one issue per invalid variable', () => {
    try {
      loadApiConfig({ PORT: 'abc' });
      throw new Error('expected failure');
    } catch (error) {
      const issues = (error as ConfigValidationError).issues;
      expect(issues.map((i) => i.variable).sort()).toEqual([
        'ALLOWED_ORIGINS',
        'DATABASE_URL',
        'INTERNAL_SERVICE_SECRET',
        'PORT',
      ]);
    }
  });

  it.each(['abc', '0', '65536', '30.5', '-1'])('rejects PORT=%s', (port) => {
    expect(messageOf({ ...validEnv(), PORT: port })).toContain('PORT');
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(messageOf({ ...validEnv(), NODE_ENV: 'staging' })).toContain('NODE_ENV');
  });

  it.each(['JWT_ACCESS_TTL', 'REFRESH_TOKEN_TTL', 'INVITATION_TTL'])(
    'rejects a malformed %s',
    (name) => {
      for (const value of ['15', '15x', 'm', '-5m', '1.5h', '0m']) {
        expect(messageOf({ ...validEnv(), [name]: value })).toContain(name);
      }
    },
  );

  it.each(['mysql://localhost/db', 'not a url', 'http://localhost'])(
    'rejects DATABASE_URL=%s',
    (url) => {
      expect(messageOf({ ...validEnv(), DATABASE_URL: url })).toContain('DATABASE_URL');
    },
  );

  it('rejects a short INTERNAL_SERVICE_SECRET', () => {
    const message = messageOf({ ...validEnv(), INTERNAL_SERVICE_SECRET: 'too-short' });
    expect(message).toContain('INTERNAL_SERVICE_SECRET');
    expect(message).toContain('32');
  });

  it.each(['localhost:5173', 'ftp://example.com', 'http://a.com/path', 'http://a.com/', ','])(
    'rejects ALLOWED_ORIGINS=%s',
    (origins) => {
      expect(messageOf({ ...validEnv(), ALLOWED_ORIGINS: origins })).toContain('ALLOWED_ORIGINS');
    },
  );

  it('never echoes secret values in the error message', () => {
    const shortSecret = 'hunter2-short';
    const message = messageOf({
      ...validEnv(),
      INTERNAL_SERVICE_SECRET: shortSecret,
      DATABASE_URL: 'mysql://user:topsecretpw@localhost/db',
      PORT: 'not-a-port',
    });
    expect(message).not.toContain(shortSecret);
    expect(message).not.toContain('topsecretpw');
    expect(message).not.toContain('not-a-port');
  });
});
