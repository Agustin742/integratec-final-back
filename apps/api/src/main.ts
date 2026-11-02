import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

export async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  const port = process.env.PORT || 3000;
  await app.listen(port);
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  bootstrap().then(() => {
    console.log('NestJS API is running');
  });
}
