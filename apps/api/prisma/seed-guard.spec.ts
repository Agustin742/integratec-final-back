import { describe, expect, it } from 'vitest';
import { assertSafeToSeed } from './seed-guard';

const CI_URL = 'postgresql://postgres:postgres@localhost:5432/aula_virtual_test?schema=public';

describe('assertSafeToSeed', () => {
  it('allows the CI database URL', () => {
    expect(() => assertSafeToSeed({ NODE_ENV: 'test', DATABASE_URL: CI_URL })).not.toThrow();
  });

  it('allows the docker-compose service host', () => {
    expect(() =>
      assertSafeToSeed({ DATABASE_URL: 'postgresql://u:p@postgres:5432/aula' }),
    ).not.toThrow();
  });

  it.each(['127.0.0.1', '[::1]'])('allows loopback host %s', (host) => {
    expect(() =>
      assertSafeToSeed({ DATABASE_URL: `postgresql://u:p@${host}:5432/aula` }),
    ).not.toThrow();
  });

  it('refuses a remote host even when NODE_ENV is unset', () => {
    expect(() =>
      assertSafeToSeed({
        DATABASE_URL: 'postgresql://u:p@aula.abc123.us-east-2.rds.amazonaws.com:5432/aula',
      }),
    ).toThrow(/aula\.abc123\.us-east-2\.rds\.amazonaws\.com/);
  });

  it.each(['production', 'staging'])('refuses NODE_ENV=%s even with a local host', (nodeEnv) => {
    expect(() => assertSafeToSeed({ NODE_ENV: nodeEnv, DATABASE_URL: CI_URL })).toThrow(nodeEnv);
  });

  it.each([undefined, '', 'not a url'])('refuses a missing or invalid URL (%s)', (url) => {
    expect(() => assertSafeToSeed({ DATABASE_URL: url })).toThrow();
  });

  it('does not leak credentials in the error message', () => {
    let message = '';
    try {
      assertSafeToSeed({ DATABASE_URL: 'postgresql://admin:s3cr3tPass@db.example.com:5432/aula' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('s3cr3tPass');
    expect(message).not.toContain('admin');
  });

  it('does not leak credentials when the URL is unparseable', () => {
    expect(() => assertSafeToSeed({ DATABASE_URL: 'user:s3cr3tPass@@@' })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('s3cr3tPass') }),
    );
  });
});
