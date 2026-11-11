const invalidDatabaseMessage =
  'DATABASE_URL must explicitly target an isolated local PostgreSQL test database';

/** Test-only boundary: no environment-file loading, defaults, or database provisioning. */
export function loadIsolatedTestDatabaseUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error(invalidDatabaseMessage);

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    // URL parser errors may include the input, which can contain credentials.
    throw new Error(invalidDatabaseMessage);
  }
  if (!['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(hostname)) {
    throw new Error(invalidDatabaseMessage);
  }
  return databaseUrl;
}
