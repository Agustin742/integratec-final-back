import { describe, it, expect } from 'vitest';
import {
  ConfigValidationError,
  DEFAULT_AUTH_CLEANUP_BATCH_SIZE,
  DEFAULT_AUTH_CLEANUP_INTERVAL_SECONDS,
  DEFAULT_AUTH_DATA_RETENTION_SECONDS,
  MAX_AUTH_CLEANUP_INTERVAL_SECONDS,
  loadApiConfig,
} from './api-config';

const SECRET = 's3cr3t-value-that-is-at-least-32-chars-long!';
const JWT_SECRET_VALUE = 'jwt-signing-key-synthetic-for-tests-0000';

const validEnv = (): Record<string, string | undefined> => ({
  DATABASE_URL: 'postgresql://user:pw@localhost:5432/aula?schema=public',
  INTERNAL_SERVICE_SECRET: SECRET,
  JWT_SECRET: JWT_SECRET_VALUE,
  ALLOWED_ORIGINS: 'http://localhost:5173',
  S3_BUCKET: 'aula-virtual-dev',
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
      refreshReuseGraceSeconds: 30,
      passwordResetTtlSeconds: 3600,
      passwordResetUrlBase: 'http://localhost:5173/reset-password',
      invitationTtlSeconds: 604800,
      outboxPollIntervalSeconds: 5,
      outboxMaxAttempts: 5,
      internalServiceSecret: SECRET,
      jwtSecret: JWT_SECRET_VALUE,
      allowedOrigins: ['http://localhost:5173'],
      s3Bucket: 'aula-virtual-dev',
      s3Region: 'sa-east-1',
      s3Endpoint: undefined,
      s3ForcePathStyle: false,
      s3Credentials: undefined,
      storageSignedUrlTtlSeconds: 300,
      authDataRetentionSeconds: 2592000,
      authCleanupIntervalSeconds: 86400,
      authCleanupBatchSize: 1000,
    });
  });

  it('keeps the exported auth cleanup defaults equal to the schema defaults', () => {
    expect(loadApiConfig(validEnv())).toMatchObject({
      authDataRetentionSeconds: DEFAULT_AUTH_DATA_RETENTION_SECONDS,
      authCleanupIntervalSeconds: DEFAULT_AUTH_CLEANUP_INTERVAL_SECONDS,
      authCleanupBatchSize: DEFAULT_AUTH_CLEANUP_BATCH_SIZE,
    });
  });

  it('accepts an AUTH_CLEANUP_INTERVAL of 7d and rejects 8d', () => {
    expect(loadApiConfig({ ...validEnv(), AUTH_CLEANUP_INTERVAL: '7d' })).toMatchObject({
      authCleanupIntervalSeconds: MAX_AUTH_CLEANUP_INTERVAL_SECONDS,
    });
    expect(MAX_AUTH_CLEANUP_INTERVAL_SECONDS).toBe(604800);
    const message = messageOf({ ...validEnv(), AUTH_CLEANUP_INTERVAL: '8d' });
    expect(message).toContain('AUTH_CLEANUP_INTERVAL');
    expect(message).toContain('between 1s and 7d');
  });

  it('parses explicit auth cleanup values', () => {
    expect(
      loadApiConfig({
        ...validEnv(),
        AUTH_DATA_RETENTION: '45d',
        AUTH_CLEANUP_INTERVAL: '6h',
        AUTH_CLEANUP_BATCH_SIZE: '250',
      }),
    ).toMatchObject({
      authDataRetentionSeconds: 3888000,
      authCleanupIntervalSeconds: 21600,
      authCleanupBatchSize: 250,
    });
  });

  it.each(['AUTH_DATA_RETENTION', 'AUTH_CLEANUP_INTERVAL'])('rejects a malformed %s', (name) => {
    for (const value of ['30', '30x', 'd', '-5d', '1.5h', '0d']) {
      expect(messageOf({ ...validEnv(), [name]: value })).toContain(name);
    }
  });

  it('accepts a retention equal to the refresh token lifetime', () => {
    expect(
      loadApiConfig({ ...validEnv(), REFRESH_TOKEN_TTL: '10d', AUTH_DATA_RETENTION: '10d' }),
    ).toMatchObject({ authDataRetentionSeconds: 864000, refreshTokenTtlSeconds: 864000 });
  });

  it('rejects a retention shorter than the refresh token lifetime', () => {
    const message = messageOf({
      ...validEnv(),
      REFRESH_TOKEN_TTL: '10d',
      AUTH_DATA_RETENTION: '9d',
    });
    expect(message).toContain('AUTH_DATA_RETENTION');
    expect(message).toContain('REFRESH_TOKEN_TTL');
  });

  it.each(['0', '10001', 'abc', '1.5', '-1'])('rejects AUTH_CLEANUP_BATCH_SIZE=%s', (value) => {
    expect(messageOf({ ...validEnv(), AUTH_CLEANUP_BATCH_SIZE: value })).toContain(
      'AUTH_CLEANUP_BATCH_SIZE',
    );
  });

  it('parses explicit values', () => {
    const config = loadApiConfig({
      ...validEnv(),
      NODE_ENV: 'production',
      PORT: '8080',
      DATABASE_URL: 'postgres://db.internal/aula',
      JWT_ACCESS_TTL: '30s',
      REFRESH_TOKEN_TTL: '2h',
      REFRESH_REUSE_GRACE: '2m',
      PASSWORD_RESET_TTL: '30m',
      PASSWORD_RESET_URL_BASE: 'https://app.example.com/reset-password',
      INVITATION_TTL: '3d',
      OUTBOX_POLL_INTERVAL: '30s',
      OUTBOX_MAX_ATTEMPTS: '8',
      ALLOWED_ORIGINS: ' https://a.example.com , https://b.example.com:8443 ',
    });
    expect(config).toMatchObject({
      nodeEnv: 'production',
      port: 8080,
      accessTokenTtlSeconds: 30,
      refreshTokenTtlSeconds: 7200,
      refreshReuseGraceSeconds: 120,
      passwordResetTtlSeconds: 1800,
      passwordResetUrlBase: 'https://app.example.com/reset-password',
      invitationTtlSeconds: 259200,
      outboxPollIntervalSeconds: 30,
      outboxMaxAttempts: 8,
      allowedOrigins: ['https://a.example.com', 'https://b.example.com:8443'],
    });
  });

  it.each([
    'DATABASE_URL',
    'INTERNAL_SERVICE_SECRET',
    'JWT_SECRET',
    'ALLOWED_ORIGINS',
    'S3_BUCKET',
  ])('names %s when it is missing', (name) => {
    const env = validEnv();
    delete env[name];
    const message = messageOf(env);
    expect(message).toContain(name);
    expect(message).toContain('required');
  });

  it('treats blank values as missing', () => {
    expect(messageOf({ ...validEnv(), DATABASE_URL: '   ' })).toContain('DATABASE_URL');
  });

  it('reports every problem together', () => {
    const message = messageOf({});
    for (const name of [
      'DATABASE_URL',
      'INTERNAL_SERVICE_SECRET',
      'JWT_SECRET',
      'ALLOWED_ORIGINS',
      'S3_BUCKET',
    ]) {
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
        'JWT_SECRET',
        'PORT',
        'S3_BUCKET',
      ]);
    }
  });

  it.each(['abc', '0', '65536', '30.5', '-1'])('rejects PORT=%s', (port) => {
    expect(messageOf({ ...validEnv(), PORT: port })).toContain('PORT');
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(messageOf({ ...validEnv(), NODE_ENV: 'staging' })).toContain('NODE_ENV');
  });

  it.each(['0', '21', 'abc', '1.5', '-1'])('rejects OUTBOX_MAX_ATTEMPTS=%s', (value) => {
    expect(messageOf({ ...validEnv(), OUTBOX_MAX_ATTEMPTS: value })).toContain(
      'OUTBOX_MAX_ATTEMPTS',
    );
  });

  it.each(['JWT_ACCESS_TTL', 'REFRESH_TOKEN_TTL', 'INVITATION_TTL', 'OUTBOX_POLL_INTERVAL'])(
    'rejects a malformed %s',
    (name) => {
      for (const value of ['15', '15x', 'm', '-5m', '1.5h', '0m']) {
        expect(messageOf({ ...validEnv(), [name]: value })).toContain(name);
      }
    },
  );

  describe('REFRESH_REUSE_GRACE', () => {
    it('accepts 0s to disable the grace window', () => {
      expect(loadApiConfig({ ...validEnv(), REFRESH_REUSE_GRACE: '0s' })).toMatchObject({
        refreshReuseGraceSeconds: 0,
      });
    });

    it.each(['30', '30x', 's', '-5s', '1.5m'])('rejects REFRESH_REUSE_GRACE=%s', (value) => {
      expect(messageOf({ ...validEnv(), REFRESH_REUSE_GRACE: value })).toContain(
        'REFRESH_REUSE_GRACE',
      );
    });

    it('rejects a window longer than 5 minutes', () => {
      expect(messageOf({ ...validEnv(), REFRESH_REUSE_GRACE: '6m' })).toContain(
        'REFRESH_REUSE_GRACE',
      );
    });
  });

  describe('password reset', () => {
    it('rejects an invalid PASSWORD_RESET_TTL', () => {
      for (const value of ['1', '1x', 'h', '0m', '-1h']) {
        expect(messageOf({ ...validEnv(), PASSWORD_RESET_TTL: value })).toContain(
          'PASSWORD_RESET_TTL',
        );
      }
    });

    it('rejects a PASSWORD_RESET_TTL longer than 24h', () => {
      expect(messageOf({ ...validEnv(), PASSWORD_RESET_TTL: '2d' })).toContain(
        'PASSWORD_RESET_TTL',
      );
    });

    it.each([
      'not a url',
      'ftp://app.example.com/reset',
      'https://app.example.com/reset?token=x',
      'https://app.example.com/reset#frag',
      'https://user:pw@app.example.com/reset',
    ])('rejects PASSWORD_RESET_URL_BASE=%s', (value) => {
      for (const nodeEnv of ['development', 'test', 'production']) {
        const message = messageOf({
          ...validEnv(),
          NODE_ENV: nodeEnv,
          PASSWORD_RESET_URL_BASE: value,
        });
        expect(message).toContain('PASSWORD_RESET_URL_BASE');
        expect(message).toContain('must be an absolute http(s) URL');
        expect(message).not.toContain(value);
        expect(message).not.toContain('pw@');
      }
    });

    it('requires PASSWORD_RESET_URL_BASE in production', () => {
      const message = messageOf({ ...validEnv(), NODE_ENV: 'production' });
      expect(message).toContain('PASSWORD_RESET_URL_BASE');
      expect(message).toContain('required');
    });

    it('rejects an HTTP PASSWORD_RESET_URL_BASE in production without echoing values', () => {
      const url = 'http://app.example.com/reset-password';
      const message = messageOf({
        ...validEnv(),
        NODE_ENV: 'production',
        PASSWORD_RESET_URL_BASE: url,
      });
      expect(message).toContain('PASSWORD_RESET_URL_BASE');
      expect(message).toContain('must use HTTPS in production');
      expect(message).not.toContain(url);
      expect(message).not.toContain(SECRET);
      expect(message).not.toContain(JWT_SECRET_VALUE);
    });

    it.each(['development', 'test'])('accepts an HTTP reset URL in %s', (nodeEnv) => {
      const url = 'http://localhost:5173/reset-password';
      expect(
        loadApiConfig({
          ...validEnv(),
          NODE_ENV: nodeEnv,
          PASSWORD_RESET_URL_BASE: url,
        }).passwordResetUrlBase,
      ).toBe(url);
    });

    it('accepts an explicit PASSWORD_RESET_URL_BASE in production', () => {
      expect(
        loadApiConfig({
          ...validEnv(),
          NODE_ENV: 'production',
          PASSWORD_RESET_URL_BASE: 'https://app.example.com/reset-password',
        }).passwordResetUrlBase,
      ).toBe('https://app.example.com/reset-password');
    });
  });

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

  it('rejects a short JWT_SECRET without echoing its value', () => {
    const message = messageOf({ ...validEnv(), JWT_SECRET: 'short-jwt-key' });
    expect(message).toContain('JWT_SECRET');
    expect(message).toContain('32');
    expect(message).not.toContain('short-jwt-key');
  });

  it.each(['localhost:5173', 'ftp://example.com', 'http://a.com/path', 'http://a.com/', ','])(
    'rejects ALLOWED_ORIGINS=%s',
    (origins) => {
      expect(messageOf({ ...validEnv(), ALLOWED_ORIGINS: origins })).toContain('ALLOWED_ORIGINS');
    },
  );

  describe('object storage', () => {
    it('parses explicit values', () => {
      const config = loadApiConfig({
        ...validEnv(),
        S3_BUCKET: 'my.bucket-1',
        S3_REGION: 'us-east-1',
        S3_ENDPOINT: 'http://localhost:9000',
        S3_FORCE_PATH_STYLE: 'true',
        S3_ACCESS_KEY_ID: 'example-access-key',
        S3_SECRET_ACCESS_KEY: 'example-secret-key',
        STORAGE_SIGNED_URL_TTL: '10m',
      });
      expect(config).toMatchObject({
        s3Bucket: 'my.bucket-1',
        s3Region: 'us-east-1',
        s3Endpoint: 'http://localhost:9000',
        s3ForcePathStyle: true,
        s3Credentials: { accessKeyId: 'example-access-key', secretAccessKey: 'example-secret-key' },
        storageSignedUrlTtlSeconds: 600,
      });
    });

    it.each(['AB', 'Upper', 'under_score', '-leading', 'trailing-', 'a'.repeat(64)])(
      'rejects S3_BUCKET=%s',
      (bucket) => {
        expect(messageOf({ ...validEnv(), S3_BUCKET: bucket })).toContain('S3_BUCKET');
      },
    );

    it.each(['sa_east_1', 'SA-EAST-1', 'region', '1-east-sa'])('rejects S3_REGION=%s', (region) => {
      expect(messageOf({ ...validEnv(), S3_REGION: region })).toContain('S3_REGION');
    });

    it.each([
      'localhost:9000',
      'ftp://minio:9000',
      'http://minio:9000/bucket',
      'http://minio:9000/',
    ])('rejects S3_ENDPOINT=%s', (endpoint) => {
      expect(messageOf({ ...validEnv(), S3_ENDPOINT: endpoint })).toContain('S3_ENDPOINT');
    });

    it.each(['yes', '1', 'TRUE'])('rejects S3_FORCE_PATH_STYLE=%s', (value) => {
      expect(messageOf({ ...validEnv(), S3_FORCE_PATH_STYLE: value })).toContain(
        'S3_FORCE_PATH_STYLE',
      );
    });

    it('requires both credentials or neither', () => {
      expect(messageOf({ ...validEnv(), S3_ACCESS_KEY_ID: 'only-id' })).toContain(
        'S3_SECRET_ACCESS_KEY',
      );
      expect(messageOf({ ...validEnv(), S3_SECRET_ACCESS_KEY: 'only-secret' })).toContain(
        'S3_ACCESS_KEY_ID',
      );
    });

    it('never echoes credentials in the error message', () => {
      const message = messageOf({
        ...validEnv(),
        S3_ACCESS_KEY_ID: 'leaky-access-key',
        S3_ENDPOINT: 'nope',
      });
      expect(message).not.toContain('leaky-access-key');
    });

    it('accepts a signed URL TTL up to one hour', () => {
      expect(
        loadApiConfig({ ...validEnv(), STORAGE_SIGNED_URL_TTL: '1h' }).storageSignedUrlTtlSeconds,
      ).toBe(3600);
      expect(
        loadApiConfig({ ...validEnv(), STORAGE_SIGNED_URL_TTL: '1s' }).storageSignedUrlTtlSeconds,
      ).toBe(1);
    });

    it.each(['61m', '2h', '1d', '0s', '5', 'abc'])('rejects STORAGE_SIGNED_URL_TTL=%s', (ttl) => {
      expect(messageOf({ ...validEnv(), STORAGE_SIGNED_URL_TTL: ttl })).toContain(
        'STORAGE_SIGNED_URL_TTL',
      );
    });
  });

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
