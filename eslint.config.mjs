import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'packages/contracts/src/realtime/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message:
            'Do not read process.env in feature code. Use the typed config (loadApiConfig / loadRealtimeConfig) and inject the validated values.',
        },
      ],
    },
  },
  {
    // The only places allowed to touch the raw environment: the config modules,
    // the process entrypoints that hand it to them, and the standalone seed script.
    files: [
      'apps/*/src/config/**/*.ts',
      'apps/api/src/main.ts',
      'apps/realtime/src/index.ts',
      'apps/api/prisma/seed.ts',
    ],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
);
