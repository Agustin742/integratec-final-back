export interface SeedEnv {
  NODE_ENV?: string;
  DATABASE_URL?: string;
}

const BLOCKED_ENVIRONMENTS = new Set(['production', 'staging']);

// Hosts where wiping every table is expected: loopback and the docker-compose
// database service name. Anything else is treated as a real database.
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'postgres']);

/**
 * Throws unless the seed (which deletes every row first) targets a local
 * development database. Messages never include the full URL or credentials.
 */
export function assertSafeToSeed(env: SeedEnv): void {
  const { NODE_ENV: nodeEnv, DATABASE_URL: databaseUrl } = env;

  if (nodeEnv && BLOCKED_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error(`Refusing to seed database in ${nodeEnv} environment`);
  }

  if (!databaseUrl) {
    throw new Error('Refusing to seed: DATABASE_URL is not set');
  }

  let hostname: string;
  try {
    hostname = new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    throw new Error('Refusing to seed: DATABASE_URL is not a valid URL');
  }

  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Refusing to seed: database host "${hostname}" is not a local host`);
  }
}
