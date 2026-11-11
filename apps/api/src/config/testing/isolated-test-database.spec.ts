import { describe, expect, it } from 'vitest';
import { loadIsolatedTestDatabaseUrl } from './isolated-test-database';

const invalidDatabaseMessage =
  'DATABASE_URL must explicitly target an isolated local PostgreSQL test database';

describe('isolated test database configuration', () => {
  it.each([undefined, ''])('rejects missing DATABASE_URL (%s) without fallback', (DATABASE_URL) => {
    expect(() => loadIsolatedTestDatabaseUrl({ DATABASE_URL })).toThrow(invalidDatabaseMessage);
  });

  it('does not use the ambient environment when an empty environment is supplied', () => {
    expect(() => loadIsolatedTestDatabaseUrl({})).toThrow(invalidDatabaseMessage);
  });

  it.each(['localhost', '127.0.0.1', '[::1]', 'postgres'])(
    'preserves an explicitly supplied local URL for %s',
    (hostname) => {
      const DATABASE_URL = `postgresql://fixture:synthetic@${hostname}:5432/isolated_test`;
      expect(loadIsolatedTestDatabaseUrl({ DATABASE_URL })).toBe(DATABASE_URL);
    },
  );

  it.each([
    'postgresql://fixture:synthetic@database.example.invalid/isolated_test',
    'postgresql://fixture:synthetic@[malformed/isolated_test',
  ])('rejects nonlocal or malformed URLs without input or parser diagnostics', (DATABASE_URL) => {
    let error: unknown;
    try {
      loadIsolatedTestDatabaseUrl({ DATABASE_URL });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(invalidDatabaseMessage);
    expect((error as Error).cause).toBeUndefined();
    expect(String(error)).not.toContain('synthetic');
    expect(String(error)).not.toContain(DATABASE_URL);
  });
});
