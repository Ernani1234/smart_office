# Imagem única do monorepo: API (que também serve o build do front) e worker.
# docker compose escolhe o comando de cada serviço.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/engine/package.json packages/engine/
COPY packages/pixel-art/package.json packages/pixel-art/
COPY tools/temporal-dev/package.json tools/temporal-dev/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @office/web build

FROM base AS runtime
ENV NODE_ENV=production OFFICE_ROOT=/app HOST=0.0.0.0
COPY --from=build /app /app
RUN git config --global user.name "Pixel Corp" && git config --global user.email "bot@pixel.corp" && git config --global init.defaultBranch main
EXPOSE 4000
CMD ["pnpm", "--filter", "@office/server", "start"]
