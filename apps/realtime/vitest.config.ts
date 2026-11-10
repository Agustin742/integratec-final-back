import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Importing Colyseus loads @pm2/io, which calls `process.send()` when it runs inside a
    // forked child process and breaks vitest's IPC channel. Worker threads have no IPC channel.
    pool: 'threads',
  },
});
