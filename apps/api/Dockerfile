# Stage 1: Build dependencies and compile
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS builder

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/contracts/tsconfig.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/realtime/package.json ./apps/realtime/

RUN pnpm install --frozen-lockfile

COPY packages/contracts/src ./packages/contracts/src
COPY apps/api/src ./apps/api/src

RUN pnpm --filter @aula/contracts build && \
    pnpm --filter @aula/api build

# Stage 2: Production runtime
FROM node:22.23.4-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate && \
    pnpm install --prod --frozen-lockfile

COPY --from=builder /app/packages/contracts/src ./packages/contracts/src
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

WORKDIR /app/apps/api

CMD ["node", "dist/main.js"]
