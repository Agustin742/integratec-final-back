import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { loadApiConfig } from './api-config';
import { API_CONFIG, ApiConfigModule } from './config.module';

describe('ApiConfigModule', () => {
  it('provides the validated config under API_CONFIG', async () => {
    const config = loadApiConfig({
      DATABASE_URL: 'postgresql://user:pw@localhost:5432/aula',
      INTERNAL_SERVICE_SECRET: 'test-only-secret-with-at-least-32-characters',
      JWT_SECRET: 'test-only-jwt-secret-with-at-least-32-chars',
      INVITATION_TOKEN_KEY: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      ALLOWED_ORIGINS: 'http://localhost:5173',
      S3_BUCKET: 'aula-virtual-dev',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [ApiConfigModule.forRoot(config)],
    }).compile();

    expect(moduleRef.get(API_CONFIG)).toBe(config);
  });
});
