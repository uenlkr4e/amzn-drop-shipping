# Local development

## Prerequisites

Node 24, Docker Desktop, `corepack enable`.

## First run

```bash
pnpm install
cp .env.example .env              # then set BETTER_AUTH_SECRET
docker compose up -d              # Postgres (dropship + dropship_test) and Redis
pnpm build
pnpm db:migrate
NEW_USER_PASSWORD='local-dev-password-123' pnpm --filter @dropship/api user:create --email dev@local.test --name Dev --role admin
pnpm dev                          # api :3000, workers, web :5173
```

Open http://localhost:5173 and sign in.

PowerShell: set the password with `$env:NEW_USER_PASSWORD='...'` on its own line first.

Local Postgres from docker-compose listens on host port **5433** (not 5432), so it does not clash with a locally
installed Postgres. `.env.example` already uses 5433. Redis is on 6379.

## User management

Users are managed **only through the CLI**. Better Auth's `/api/auth/admin/*` HTTP routes are blocked (404).
`user:create` is audited. Running it for an existing email only updates the role; it does not change the password or
name.

## Everyday commands

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Runs api, workers and web in watch mode |
| `pnpm test` | Unit + integration tests (needs `docker compose up -d`) |
| `pnpm lint` / `pnpm format` | Biome check / fix |
| `pnpm typecheck` | TypeScript across all packages |
| `pnpm db:generate` | Create a migration after editing `packages/database/src/schema` |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |
| `pnpm --filter @dropship/api openapi:export && pnpm --filter @dropship/web api:types` | Refresh the API contract after changing controllers or DTOs (CI fails if you forget) |
| `pnpm --filter @dropship/e2e e2e` | Playwright end-to-end tests |

For e2e, run `pnpm build` first and make sure nothing is listening on ports 3000 or 4173.

Vitest configs in the backend packages are `vitest.config.mts`.

## Auth behaviour in development

Origin/CSRF checks are always on. Sign-in and TOTP verification are rate-limited (5/min per IP) by Better Auth's
in-memory limiter whenever `APP_ENV` is not `test`. `REQUIRE_2FA=false` is fine locally, but `REQUIRE_2FA=true` is
enforced (startup fails otherwise) when `APP_ENV=production`.

## Version pins

Do not upgrade these blindly:

- **NestJS stays on v11.** v12 is ESM-only and the backend is CommonJS.
- **TypeScript ~5.9** (not 7).
- **`@types/node` ^24**, matching Node 24.

## Troubleshooting

- **`ERR_PNPM_IGNORED_BUILDS` on `pnpm install`:** pnpm blocks dependency install scripts by default. Every
  dependency that has one must be listed in `allowBuilds` in `pnpm-workspace.yaml` (`true` to run it, `false` to skip
  it deliberately). Add the package it names.
- **Cannot connect to Postgres:** use port 5433, not 5432.
- **e2e fails to start servers:** something is already listening on 3000 or 4173, or `pnpm build` was not run.

## Adding a worker group

1. Create `apps/workers/src/<group>/<group>.module.ts` registering its queues and processors.
2. Add the queue name to `QUEUE_NAMES` in `packages/queue/src/names.ts` (the ops dashboard picks it up).
3. Add the module to `WORKER_GROUP_MODULES` in `apps/workers/src/workers.module.ts`.
4. Add the group to `WORKER_GROUPS` for the Railway service that should run it.

## Calling an external provider

Wrap every provider call with both the rate limiter and the integration log:

```ts
await limiter.acquire(`sp-api:${sellerId}:getOrders`, { capacity: 20, refillPerSecond: 0.0167 });
const orders = await withIntegrationLog(
  db,
  { provider: 'sp-api', operation: 'getOrders', accountRef: sellerId },
  () => client.getOrders(params),
);
```
