import { listen } from '@colyseus/tools';
import { createAppConfig } from './app.config';
import { ApiJoinVerifier } from './join/api-join-verifier';
import { ApiConnectedTimeReporter } from './time/api-connected-time-reporter';
import { start } from './start';

start(
  process.env,
  (code) => process.exit(code),
  (port, config) =>
    listen(
      createAppConfig(
        new ApiJoinVerifier({
          baseUrl: config.apiInternalUrl,
          serviceSecret: config.internalServiceSecret,
        }),
        {
          internalServiceSecret: config.internalServiceSecret,
          reconnectionWindowSeconds: config.reconnectionWindowSeconds,
          reporter: new ApiConnectedTimeReporter({
            baseUrl: config.apiInternalUrl,
            serviceSecret: config.internalServiceSecret,
          }),
        },
      ),
      port,
    ),
);
