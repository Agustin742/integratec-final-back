import { listen } from '@colyseus/tools';
import appConfig from './app.config';
import { start } from './start';

start(
  process.env,
  (code) => process.exit(code),
  (port) => listen(appConfig, port),
);
