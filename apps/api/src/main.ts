import { start } from './bootstrap';

start(process.env, (code) => process.exit(code)).catch((err: unknown) => {
  console.error('Failed to start NestJS API:', err);
  process.exit(1);
});
