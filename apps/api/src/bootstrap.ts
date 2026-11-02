import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module';

export async function bootstrap(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`NestJS API is running on port ${port}`);
  return app;
}
