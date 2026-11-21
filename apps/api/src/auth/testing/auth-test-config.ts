import type { ApiConfig } from '../../config/api-config';

// Same approach as prisma.spec.ts: the database URL comes from the environment (CI sets it).
const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
  .process?.env;
const TEST_DATABASE_URL =
  env?.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/aula_virtual?schema=public';

/** Synthetic, clearly non-secret configuration for auth integration specs. */
export const AUTH_TEST_JWT_SECRET = 'synthetic-jwt-secret-for-auth-specs-only-0000';

export const authTestConfig = (overrides: Partial<ApiConfig> = {}): ApiConfig => ({
  nodeEnv: 'test',
  port: 3000,
  databaseUrl: TEST_DATABASE_URL,
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 604800,
  refreshReuseGraceSeconds: 30,
  passwordResetTtlSeconds: 3600,
  passwordResetUrlBase: 'https://app.example.test/reset-password',
  invitationTtlSeconds: 604800,
  outboxPollIntervalSeconds: 5,
  outboxMaxAttempts: 5,
  realtimeInternalUrl: 'http://localhost:2567',
  internalServiceSecret: 'synthetic-internal-secret-for-auth-specs-0000',
  jwtSecret: AUTH_TEST_JWT_SECRET,
  invitationTokenKey: Buffer.alloc(32, 1),
  allowedOrigins: ['http://localhost:5173'],
  s3Bucket: 'synthetic-bucket',
  s3Region: 'sa-east-1',
  s3Endpoint: undefined,
  s3ForcePathStyle: false,
  s3Credentials: undefined,
  storageSignedUrlTtlSeconds: 300,
  authDataRetentionSeconds: 2592000,
  authCleanupIntervalSeconds: 86400,
  authCleanupBatchSize: 1000,
  gradeWeightTp: 1,
  gradeWeightExam: 1.5,
  aiProviderApiKey: undefined,
  aiProviderBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  aiChatModel: 'gemini-2.5-flash',
  aiEmbeddingModel: 'gemini-embedding-001',
  aiEmbeddingDimension: 768,
  aiRequestTimeoutSeconds: 20,
  aiMaxRetries: 1,
  aiMaxToolIterations: 4,
  aiRetrievalTopK: 5,
  aiRetrievalMinSimilarity: 0.35,
  aiChunkMaxChars: 2400,
  aiChunkOverlapChars: 300,
  aiBotRateLimitWindowSeconds: 60,
  aiBotRateLimitUserMax: 10,
  aiBotRateLimitClassroomMax: 60,
  aiBotRateLimitGlobalMax: 300,
  ...overrides,
});
