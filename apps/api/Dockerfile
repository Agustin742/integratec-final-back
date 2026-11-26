# Stage 1: Build dependencies and compile
FROM public.ecr.aws/docker/library/node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS builder

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/contracts/tsconfig.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json ./apps/api/
COPY apps/api/prisma ./apps/api/prisma
COPY apps/realtime/package.json ./apps/realtime/

RUN pnpm install --frozen-lockfile && \
    pnpm --filter @aula/api prisma:generate

COPY packages/contracts/src ./packages/contracts/src
COPY apps/api/src ./apps/api/src

RUN pnpm --filter @aula/contracts build && \
    pnpm --filter @aula/api build && \
    test -f apps/api/dist/main.js

# Stage only the generated Prisma client (.prisma/client) with its original
# relative path, so the runtime stage can copy it without dev dependencies.
RUN mkdir -p /prisma-generated && \
    tar -cf - node_modules/.pnpm/@prisma+client*/node_modules/.prisma | tar -xf - -C /prisma-generated

# Stage 2: One-shot migration job. Derived from the builder because only it has the Prisma CLI
# (the runtime stage installs production dependencies only). The host runs it with
# DATABASE_URL in the environment before the api starts; it applies the committed migrations,
# adds any missing shop catalog items and exits. It stays above `runner` so that a plain `docker build` still yields the api image.
FROM builder AS migrate

USER node

WORKDIR /app/apps/api

CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && node_modules/.bin/ts-node --transpile-only prisma/load-shop-catalog.ts"]

# Stage 3: Production runtime
FROM public.ecr.aws/docker/library/node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
COPY apps/api/prisma ./apps/api/prisma

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate && \
    pnpm install --prod --frozen-lockfile

COPY --from=builder /prisma-generated/ /app/
COPY --from=builder /app/packages/contracts/src ./packages/contracts/src
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

WORKDIR /app/apps/api

CMD ["node", "dist/main.js"]
