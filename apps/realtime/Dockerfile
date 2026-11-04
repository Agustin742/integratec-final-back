# Stage 1: Build dependencies and compile
FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/contracts/tsconfig.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
COPY apps/realtime/package.json ./apps/realtime/
COPY apps/realtime/tsconfig.json ./apps/realtime/

RUN pnpm install --frozen-lockfile

COPY packages/contracts/src ./packages/contracts/src
COPY apps/realtime/src ./apps/realtime/src

RUN pnpm --filter @aula/contracts build && \
    pnpm --filter @aula/realtime build

# Stage 2: Production runtime
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=2567

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/realtime/package.json ./apps/realtime/

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate && \
    pnpm install --prod --frozen-lockfile

COPY --from=builder /app/packages/contracts/src ./packages/contracts/src
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/apps/realtime/dist ./apps/realtime/dist

USER node

EXPOSE 2567

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:2567/health || exit 1

WORKDIR /app/apps/realtime

CMD ["node", "dist/index.js"]
