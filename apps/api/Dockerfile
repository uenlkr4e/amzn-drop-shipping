FROM node:24-slim AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@^2 prune @dropship/api --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# turbo prune does not copy root tsconfig files that the packages extend.
COPY --from=pruner /app/tsconfig.base.json /app/tsconfig.nest.json ./
RUN pnpm turbo run build --filter=@dropship/api

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app .
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
