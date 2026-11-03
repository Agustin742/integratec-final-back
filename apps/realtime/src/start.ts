import {
  ConfigValidationError,
  loadRealtimeConfig,
  type RealtimeConfig,
} from './config/realtime-config';

/**
 * Validates `env` before listening. An invalid configuration is reported on
 * stderr and terminates the process with exit code 1 without opening a port.
 */
export function start(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  exit: (code: number) => void,
  listen: (port: number) => unknown,
): void {
  let config: RealtimeConfig;
  try {
    config = loadRealtimeConfig(env);
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(error.message);
      exit(1);
      return;
    }
    throw error;
  }
  listen(config.port);
}
