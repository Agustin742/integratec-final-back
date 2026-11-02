import { bootstrap } from './bootstrap';

bootstrap().catch((err: unknown) => {
  console.error('Failed to start NestJS API:', err);
  process.exit(1);
});
