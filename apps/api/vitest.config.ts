import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// esbuild (Vitest's default) does not emit decorator metadata, which Nest's
// ValidationPipe needs to discover DTO classes. SWC does, like `tsc` in the build.
export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
