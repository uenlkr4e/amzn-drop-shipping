# Phase 1: Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable staging platform with authentication (roles + 2FA), database migrations, background workers, a shared provider rate limiter, audit/integration logging, health checks, an operations status dashboard, CI, and Railway deployment config.

**Architecture:** pnpm + Turborepo monorepo. Framework-agnostic packages (`config`, `observability`, `database`, `queue`) are compiled with `tsc` to CommonJS and consumed by a NestJS/Fastify API, a NestJS standalone worker process, and a Vite React SPA. PostgreSQL (Drizzle) is the source of truth; Redis backs BullMQ and the token-bucket rate limiter. The SPA is served by Caddy, which also reverse-proxies `/api/*` to the API so the browser sees a single origin and session cookies stay simple.

**Tech Stack:** Node.js 24, TypeScript ≥ 5.8, pnpm, Turborepo 2, Biome 2, NestJS 11 + Fastify 5, Drizzle ORM + Drizzle Kit, PostgreSQL 17, Redis 7.4, BullMQ 5 + `@nestjs/bullmq`, Better Auth (admin + twoFactor plugins), Zod 4, Pino, Sentry, Vite, React 19, TanStack Router + Query, Tailwind CSS 4, shadcn/ui, openapi-typescript + openapi-fetch, Vitest, Playwright, Docker, Caddy, Railway.

**Spec:** [`docs/architecture/platform-plan.md`](../architecture/platform-plan.md) §4, §5, §7, §9 Phase 1, §13.

---

## Before you start

- **Read** platform plan §4 (stack), §5.1 (layout), §13 (agent rules).
- **Tools:** Node 24 (`node -v`), Docker Desktop running, Git. Enable pnpm with `corepack enable`.
- **Versions:** dependencies are installed with `pnpm add <name>` (latest). This plan's code was written against: NestJS 11, Fastify 5, drizzle-orm 0.45 / drizzle-kit 0.31, Better Auth 1.7, BullMQ 5, Zod 4, Vite 7, Tailwind 4, TanStack Router 1, React 19, Biome 2. If `pnpm add` installs a **different major version**, read that library's migration guide before continuing and adapt the code; note the change in the task's commit message.
- **Module format:** backend packages compile to **CommonJS** (`module: NodeNext` without `"type": "module"`). Node 24 can `require()` ESM-only dependencies, and TypeScript ≥ 5.8 type-checks that. Relative imports therefore need **no** file extensions. The web app is ESM (Vite).
- **Windows:** all scripts are cross-platform. Do not use `&`, `export VAR=`, or `rm -rf` in `package.json` scripts.
- **Test isolation:** integration tests use a separate database whose name **must end in `_test`** (enforced in code) and Redis logical DB 1. Turborepo runs package test suites one at a time (`--concurrency=1`) and Vitest runs files sequentially in integration packages, because suites share these resources.

## File structure

```text
.
├── package.json                    # root scripts (turbo, biome)
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
├── tsconfig.base.json              # shared TS options (CJS/NodeNext)
├── tsconfig.nest.json              # + decorator options for Nest code
├── .nvmrc  .gitignore  .dockerignore  .env.example
├── docker-compose.yml              # local Postgres + Redis
├── docker/postgres/init.sql        # creates dropship_test database
├── packages/
│   ├── config/                     # env schemas, parseEnv, loadDotEnv
│   ├── observability/              # pino logger options + redaction
│   ├── database/                   # Drizzle schema, client, migrations, repositories, test helpers
│   ├── queue/                      # queue names, Redis URL parsing, token-bucket rate limiter
│   └── nest-common/                # Nest DatabaseModule + RedisModule
├── apps/
│   ├── api/                        # NestJS + Fastify: health, auth, me, ops status, scripts
│   ├── workers/                    # NestJS standalone: heartbeat, system queue
│   └── web/                        # Vite React SPA + Caddy image
├── e2e/                            # Playwright end-to-end tests
├── deployment/railway/             # Railway config-as-code per service
├── .github/workflows/ci.yml
└── docs/operations/                # local development + Railway runbook
```

Packages from platform plan §5.1 that are not needed yet (`shared`, `validation`, `providers/*`) are created by the plans that first need them.

---

### Task 1: Monorepo scaffold and local infrastructure

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `biome.json`, `tsconfig.base.json`, `tsconfig.nest.json`, `.nvmrc`, `.gitignore`, `.dockerignore`, `.env.example`, `docker-compose.yml`, `docker/postgres/init.sql`

- [ ] **Step 1: Create the workspace files**

`.nvmrc`:
```text
24
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "e2e"
```

`package.json`:
```json
{
  "name": "dropship-platform",
  "private": true,
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test --concurrency=1",
    "lint": "biome check .",
    "format": "biome check --write .",
    "db:generate": "pnpm --filter @dropship/database db:generate",
    "db:migrate": "pnpm --filter @dropship/database db:migrate"
  }
}
```

`turbo.json`:
```json
{
  "$schema": "https://turborepo.com/schema.json",
  "globalPassThroughEnv": [
    "APP_ENV",
    "NODE_ENV",
    "LOG_LEVEL",
    "PORT",
    "DATABASE_URL",
    "REDIS_URL",
    "TEST_DATABASE_URL",
    "TEST_REDIS_URL",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "WEB_ORIGIN",
    "REQUIRE_2FA",
    "SENTRY_DSN",
    "WORKER_GROUPS",
    "CI"
  ],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"],
      "cache": false
    },
    "dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    }
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  }
}
```

`tsconfig.nest.json`:
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strictPropertyInitialization": false
  }
}
```

`biome.json` (`useImportType` is off because NestJS dependency injection needs real imports for decorator metadata):
```json
{
  "files": {
    "includes": [
      "**",
      "!**/dist",
      "!**/node_modules",
      "!**/.turbo",
      "!**/migrations",
      "!apps/api/openapi.json",
      "!apps/web/src/api/schema.d.ts",
      "!apps/web/src/routeTree.gen.ts",
      "!apps/web/src/components/ui",
      "!e2e/playwright-report",
      "!e2e/test-results",
      "!.idea"
    ]
  },
  "formatter": {
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "javascript": {
    "formatter": { "quoteStyle": "single" },
    "parser": { "unsafeParameterDecoratorsEnabled": true }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "style": { "useImportType": "off" }
    }
  }
}
```

`.gitignore`:
```text
node_modules/
dist/
.turbo/
coverage/
*.tsbuildinfo
.env
e2e/playwright-report/
e2e/test-results/
```

`.dockerignore`:
```text
**/node_modules
**/dist
**/.turbo
.git
.idea
.env
e2e/playwright-report
e2e/test-results
```

`.env.example`:
```text
APP_ENV=development
LOG_LEVEL=info
PORT=3000
DATABASE_URL=postgres://dropship:dropship@localhost:5433/dropship
REDIS_URL=redis://localhost:6379/0
TEST_DATABASE_URL=postgres://dropship:dropship@localhost:5433/dropship_test
TEST_REDIS_URL=redis://localhost:6379/1
# At least 32 characters. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
BETTER_AUTH_SECRET=replace-with-a-random-string-of-32-chars-or-more
# Public origin the browser uses. In development this is the Vite dev server, which proxies /api.
BETTER_AUTH_URL=http://localhost:5173
WEB_ORIGIN=http://localhost:5173
# Must be true in production (enforced). Set false locally to skip 2FA setup while developing.
REQUIRE_2FA=false
SENTRY_DSN=
WORKER_GROUPS=system
```

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:17
    environment:
      POSTGRES_USER: dropship
      POSTGRES_PASSWORD: dropship
      POSTGRES_DB: dropship
    ports:
      - "5433:5432"   # 5433 on the host: avoids clashing with a locally installed Postgres
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dropship"]
      interval: 5s
      timeout: 5s
      retries: 10
  redis:
    image: redis:7.4
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction"]
    ports:
      - "6379:6379"
    volumes:
      - redisdata:/data
volumes:
  pgdata: {}
  redisdata: {}
```

`docker/postgres/init.sql`:
```sql
CREATE DATABASE dropship_test;
```

- [ ] **Step 2: Install root tooling**

```bash
corepack use pnpm@latest
pnpm add -D -w turbo @biomejs/biome typescript @types/node
cp .env.example .env
```

Expected: `package.json` gains a `packageManager` field and `devDependencies`; `pnpm-lock.yaml` is created.

- [ ] **Step 3: Verify tooling and local infrastructure**

```bash
pnpm lint
docker compose up -d
docker compose exec redis redis-cli CONFIG GET maxmemory-policy
docker compose exec postgres psql -U dropship -c "\l" | grep dropship_test
```

Expected: `pnpm lint` reports no errors; Redis prints `maxmemory-policy` / `noeviction`; the `psql` output lists `dropship_test`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm/turbo monorepo and local infrastructure"
```

---

### Task 2: `@dropship/config` — environment validation

**Files:**
- Create: `packages/config/package.json`, `packages/config/tsconfig.json`, `packages/config/tsconfig.build.json`
- Create: `packages/config/src/env.ts`, `packages/config/src/dotenv.ts`, `packages/config/src/index.ts`
- Test: `packages/config/src/env.test.ts`, `packages/config/src/dotenv.test.ts`

- [ ] **Step 1: Create the package skeleton**

`packages/config/package.json`:
```json
{
  "name": "@dropship/config",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

`packages/config/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/config/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

```bash
pnpm --filter @dropship/config add zod
pnpm --filter @dropship/config add -D vitest typescript @types/node
```

- [ ] **Step 2: Write the failing env tests**

`packages/config/src/env.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { apiEnvSchema, EnvValidationError, parseEnv, workerEnvSchema } from './env';

const validApi = {
  APP_ENV: 'development',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379/0',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'http://localhost:5173',
  WEB_ORIGIN: 'http://localhost:5173',
};

describe('parseEnv(apiEnvSchema)', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = parseEnv(apiEnvSchema, validApi);
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.REQUIRE_2FA).toBe(true);
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('parses REQUIRE_2FA=false as boolean false', () => {
    const env = parseEnv(apiEnvSchema, { ...validApi, REQUIRE_2FA: 'false' });
    expect(env.REQUIRE_2FA).toBe(false);
  });

  it('treats an empty SENTRY_DSN as unset', () => {
    const env = parseEnv(apiEnvSchema, { ...validApi, SENTRY_DSN: '' });
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it('names every missing or invalid variable in one error', () => {
    const { DATABASE_URL: _db, ...rest } = validApi;
    const call = () => parseEnv(apiEnvSchema, { ...rest, BETTER_AUTH_SECRET: 'short' });
    expect(call).toThrow(EnvValidationError);
    expect(call).toThrow(/DATABASE_URL/);
    expect(call).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('refuses REQUIRE_2FA=false in production', () => {
    const call = () =>
      parseEnv(apiEnvSchema, { ...validApi, APP_ENV: 'production', REQUIRE_2FA: 'false' });
    expect(call).toThrow(/REQUIRE_2FA/);
  });
});

describe('parseEnv(workerEnvSchema)', () => {
  it('splits WORKER_GROUPS into a trimmed list', () => {
    const env = parseEnv(workerEnvSchema, {
      DATABASE_URL: validApi.DATABASE_URL,
      REDIS_URL: validApi.REDIS_URL,
      WORKER_GROUPS: 'system, research ,',
    });
    expect(env.WORKER_GROUPS).toEqual(['system', 'research']);
  });

  it('requires at least one worker group', () => {
    const call = () =>
      parseEnv(workerEnvSchema, {
        DATABASE_URL: validApi.DATABASE_URL,
        REDIS_URL: validApi.REDIS_URL,
        WORKER_GROUPS: ' , ',
      });
    expect(call).toThrow(/WORKER_GROUPS/);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @dropship/config test`
Expected: FAIL — `Cannot find module './env'`.

- [ ] **Step 4: Implement `env.ts`**

`packages/config/src/env.ts`:
```ts
import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const baseEnvShape = {
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  SENTRY_DSN: z.preprocess(emptyToUndefined, z.url().optional()),
};

export const apiEnvSchema = z
  .object({
    ...baseEnvShape,
    PORT: z.coerce.number().int().positive().default(3000),
    BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    BETTER_AUTH_URL: z.url(),
    WEB_ORIGIN: z.url(),
    REQUIRE_2FA: z.stringbool().default(true),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === 'production' && !env.REQUIRE_2FA) {
      ctx.addIssue({
        code: 'custom',
        path: ['REQUIRE_2FA'],
        message: 'must be true when APP_ENV=production',
      });
    }
  });

export const workerEnvSchema = z.object({
  ...baseEnvShape,
  WORKER_GROUPS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((group) => group.trim())
        .filter((group) => group.length > 0),
    )
    .pipe(z.array(z.string()).min(1, 'must list at least one worker group')),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new EnvValidationError(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
```

- [ ] **Step 5: Run env tests**

Run: `pnpm --filter @dropship/config test`
Expected: env tests PASS (dotenv tests don't exist yet).

- [ ] **Step 6: Write the failing `.env` discovery tests**

`packages/config/src/dotenv.test.ts`:
```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findWorkspaceEnvFile, loadDotEnv } from './dotenv';

function makeWorkspace(withEnv: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'ws-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  if (withEnv) writeFileSync(join(root, '.env'), 'X=1\n');
  const nested = join(root, 'apps', 'api');
  mkdirSync(nested, { recursive: true });
  return { root, nested };
}

describe('findWorkspaceEnvFile', () => {
  it('finds the workspace-root .env from a nested directory', () => {
    const { root, nested } = makeWorkspace(true);
    expect(findWorkspaceEnvFile(nested)).toBe(join(root, '.env'));
  });

  it('stops at the workspace root when there is no .env', () => {
    const { nested } = makeWorkspace(false);
    expect(findWorkspaceEnvFile(nested)).toBeUndefined();
  });
});

describe('loadDotEnv', () => {
  afterEach(() => {
    delete process.env.DOTENV_TEST_A;
    delete process.env.DOTENV_TEST_B;
  });

  it('fills in missing variables but never overrides ones already set', () => {
    const { root, nested } = makeWorkspace(false);
    writeFileSync(join(root, '.env'), 'DOTENV_TEST_A=from-file\nDOTENV_TEST_B=from-file\n');
    process.env.DOTENV_TEST_A = 'from-env';
    expect(loadDotEnv(nested)).toBe(join(root, '.env'));
    expect(process.env.DOTENV_TEST_A).toBe('from-env');
    expect(process.env.DOTENV_TEST_B).toBe('from-file');
  });
});
```

- [ ] **Step 7: Run to verify failure**

Run: `pnpm --filter @dropship/config test`
Expected: FAIL — `Cannot find module './dotenv'`.

- [ ] **Step 8: Implement `dotenv.ts` and the package index**

`packages/config/src/dotenv.ts`:
```ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnv as parseDotEnvFile } from 'node:util';

/** Walks up from startDir to the pnpm workspace root looking for a .env file. */
export function findWorkspaceEnvFile(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Loads the workspace .env into process.env for local development and scripts.
 * Variables already set (e.g. by a test harness) win over the file.
 * Never loads a file in staging or production, where Railway injects variables.
 */
export function loadDotEnv(startDir: string = process.cwd()): string | undefined {
  const appEnv = process.env.APP_ENV;
  if (appEnv === 'staging' || appEnv === 'production') return undefined;
  const file = findWorkspaceEnvFile(startDir);
  if (!file) return undefined;
  for (const [key, value] of Object.entries(parseDotEnvFile(readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return file;
}
```

`packages/config/src/index.ts`:
```ts
export * from './dotenv';
export * from './env';
```

- [ ] **Step 9: Run all config tests and build**

Run: `pnpm --filter @dropship/config test && pnpm --filter @dropship/config build`
Expected: all tests PASS; `packages/config/dist/index.js` exists.

- [ ] **Step 10: Commit**

```bash
git add packages/config pnpm-lock.yaml
git commit -m "feat(config): add validated environment schemas and .env loader"
```

---

### Task 3: `@dropship/observability` — logger options with redaction

**Files:**
- Create: `packages/observability/package.json`, `tsconfig.json`, `tsconfig.build.json`, `src/logger.ts`, `src/index.ts`
- Test: `packages/observability/src/logger.test.ts`

- [ ] **Step 1: Create the package skeleton**

`packages/observability/package.json`:
```json
{
  "name": "@dropship/observability",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

`packages/observability/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/observability/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

```bash
pnpm --filter @dropship/observability add pino
pnpm --filter @dropship/observability add -D vitest typescript @types/node
```

- [ ] **Step 2: Write the failing test**

`packages/observability/src/logger.test.ts`:
```ts
import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { createLoggerOptions } from './logger';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(JSON.parse(chunk.toString()));
      cb();
    },
  });
  return { lines, stream };
}

describe('createLoggerOptions', () => {
  it('tags every line with service and environment', () => {
    const { lines, stream } = capture();
    const logger = pino(createLoggerOptions({ service: 'api', level: 'info', appEnv: 'test' }), stream);
    logger.info('hello');
    expect(lines[0]).toMatchObject({ service: 'api', env: 'test', msg: 'hello' });
  });

  it('redacts credentials, cookies and tokens', () => {
    const { lines, stream } = capture();
    const logger = pino(createLoggerOptions({ service: 'api', level: 'info', appEnv: 'test' }), stream);
    logger.info(
      {
        req: { headers: { authorization: 'Bearer abc', cookie: 'session=abc' } },
        credentials: { password: 'hunter2', accessToken: 'a', refreshToken: 'r', secret: 's' },
      },
      'request',
    );
    const serialized = JSON.stringify(lines[0]);
    for (const secret of ['Bearer abc', 'session=abc', 'hunter2', '"a"', '"r"', '"s"']) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('[REDACTED]');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @dropship/observability test`
Expected: FAIL — `Cannot find module './logger'`.

- [ ] **Step 4: Implement**

`packages/observability/src/logger.ts`:
```ts
import type { LoggerOptions } from 'pino';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

/** Paths removed from every log line. Extend when a provider adds new secret fields. */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.accessToken',
  '*.refreshToken',
  '*.secret',
  '*.token',
  '*.apiKey',
];

export function createLoggerOptions(input: {
  service: string;
  level: LogLevel;
  appEnv: string;
}): LoggerOptions {
  return {
    level: input.level,
    base: { service: input.service, env: input.appEnv },
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  };
}
```

`packages/observability/src/index.ts`:
```ts
export * from './logger';
```

- [ ] **Step 5: Run tests and build**

Run: `pnpm --filter @dropship/observability test && pnpm --filter @dropship/observability build`
Expected: PASS; `dist/index.js` exists.

- [ ] **Step 6: Commit**

```bash
git add packages/observability pnpm-lock.yaml
git commit -m "feat(observability): add pino logger options with secret redaction"
```

---

### Task 4: `@dropship/database` — schema, client, migrations

**Files:**
- Create: `packages/database/package.json`, `tsconfig.json`, `tsconfig.build.json`, `drizzle.config.ts`, `vitest.config.ts`
- Create: `packages/database/src/schema/auth.ts`, `src/schema/ops.ts`, `src/schema/index.ts`
- Create: `packages/database/src/client.ts`, `src/migrate.ts`, `src/migrate-cli.ts`, `src/testing.ts`, `src/index.ts`
- Create: `packages/database/test/global-setup.ts`
- Generated: `packages/database/migrations/*`
- Test: `packages/database/src/client.test.ts`

- [ ] **Step 1: Create the package skeleton**

`packages/database/package.json`:
```json
{
  "name": "@dropship/database",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./testing": { "types": "./dist/testing.d.ts", "default": "./dist/testing.js" }
  },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "node dist/migrate-cli.js"
  }
}
```

`packages/database/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/database/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/database/vitest.config.ts`:
```ts
import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
```

`packages/database/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
```

```bash
pnpm --filter @dropship/database add drizzle-orm pg @dropship/config@workspace:*
pnpm --filter @dropship/database add -D drizzle-kit @types/pg vitest typescript @types/node
```

- [ ] **Step 2: Write the schema**

`packages/database/src/schema/auth.ts` — Better Auth core tables plus the `admin` and `twoFactor` plugin fields. **Property names must stay camelCase**: Better Auth's Drizzle adapter maps by property name; column names are snake_case.
```ts
import { boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  ...timestamps,
  // admin plugin
  role: text('role'),
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires', { withTimezone: true }),
  // twoFactor plugin
  twoFactorEnabled: boolean('two_factor_enabled').default(false),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    ...timestamps,
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // admin plugin
    impersonatedBy: text('impersonated_by'),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps,
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export const twoFactor = pgTable(
  'two_factor',
  {
    id: text('id').primaryKey(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [index('two_factor_secret_idx').on(t.secret), index('two_factor_user_id_idx').on(t.userId)],
);

/** Passed to Better Auth's Drizzle adapter. Keys are Better Auth model names. */
export const authSchema = { user, session, account, verification, twoFactor };
```

`packages/database/src/schema/ops.ts`:
```ts
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorType: text('actor_type', { enum: ['user', 'system'] }).notNull(),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    correlationId: text('correlation_id'),
  },
  (t) => [
    index('audit_logs_entity_idx').on(t.entityType, t.entityId),
    index('audit_logs_occurred_at_idx').on(t.occurredAt),
  ],
);

export const integrationLogs = pgTable(
  'integration_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    provider: text('provider').notNull(),
    operation: text('operation').notNull(),
    accountRef: text('account_ref'),
    status: text('status', { enum: ['success', 'error', 'throttled'] }).notNull(),
    httpStatus: integer('http_status'),
    durationMs: integer('duration_ms').notNull(),
    errorMessage: text('error_message'),
    correlationId: text('correlation_id'),
    details: jsonb('details').$type<Record<string, unknown>>(),
  },
  (t) => [index('integration_logs_provider_idx').on(t.provider, t.occurredAt)],
);

export const workerHeartbeats = pgTable(
  'worker_heartbeats',
  {
    workerGroup: text('worker_group').notNull(),
    instanceId: text('instance_id').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workerGroup, t.instanceId] })],
);
```

`packages/database/src/schema/index.ts`:
```ts
export * from './auth';
export * from './ops';
```

- [ ] **Step 3: Write the client, migrator and test helpers**

`packages/database/src/client.ts`:
```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  pool: Pool;
  close(): Promise<void>;
}

export function createDatabase(
  url: string,
  options: { maxConnections?: number } = {},
): DatabaseHandle {
  const pool = new Pool({ connectionString: url, max: options.maxConnections ?? 10 });
  const db = drizzle({ client: pool, schema });
  let closed = false;
  return {
    db,
    pool,
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
    },
  };
}
```

`packages/database/src/migrate.ts`:
```ts
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client';

/** Works from both src/ (tests) and dist/ (runtime): migrations/ is a sibling of both. */
export const MIGRATIONS_FOLDER = join(__dirname, '..', 'migrations');

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
```

`packages/database/src/migrate-cli.ts`:
```ts
import { loadDotEnv } from '@dropship/config';
import { createDatabase } from './client';
import { runMigrations } from './migrate';

async function main() {
  loadDotEnv();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const handle = createDatabase(url, { maxConnections: 1 });
  try {
    await runMigrations(handle.db);
    console.log('Migrations applied');
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

`packages/database/src/testing.ts`:
```ts
import { sql } from 'drizzle-orm';
import { createDatabase, type Database, type DatabaseHandle } from './client';
import { runMigrations } from './migrate';

/** Refuses any database whose name does not end in _test, so tests can never wipe real data. */
export function assertTestDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error('TEST_DATABASE_URL must be set for integration tests');
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to use database "${name}" for tests: name must end in _test`);
  }
  return url;
}

export function connectTestDatabase(): DatabaseHandle {
  return createDatabase(assertTestDatabaseUrl(process.env.TEST_DATABASE_URL), {
    maxConnections: 5,
  });
}

export async function prepareTestDatabase(): Promise<void> {
  const handle = connectTestDatabase();
  try {
    await runMigrations(handle.db);
  } finally {
    await handle.close();
  }
}

export async function truncateAll(db: Database): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE "user", audit_logs, integration_logs, worker_heartbeats RESTART IDENTITY CASCADE`,
  );
}
```

`packages/database/src/index.ts`:
```ts
export * from './client';
export * from './migrate';
export * from './schema';
```

`packages/database/test/global-setup.ts`:
```ts
import { prepareTestDatabase } from '../src/testing';

export default async function setup() {
  await prepareTestDatabase();
}
```

- [ ] **Step 4: Generate the first migration**

Run: `pnpm --filter @dropship/database db:generate`
Expected: `packages/database/migrations/0000_<name>.sql` plus `migrations/meta/`. Open the SQL and confirm it creates `user`, `session`, `account`, `verification`, `two_factor`, `audit_logs`, `integration_logs`, `worker_heartbeats`.

- [ ] **Step 5: Write the failing client test**

`packages/database/src/client.test.ts`:
```ts
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl, connectTestDatabase } from './testing';

describe('database client', () => {
  const handle = connectTestDatabase();
  afterAll(() => handle.close());

  it('connects and sees the migrated tables', async () => {
    const result = await handle.db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tables = result.rows.map((r) => r.table_name);
    expect(tables).toEqual(
      expect.arrayContaining(['user', 'session', 'audit_logs', 'integration_logs', 'worker_heartbeats']),
    );
  });

  it('refuses non-test database names', () => {
    expect(() => assertTestDatabaseUrl('postgres://u:p@localhost:5432/dropship')).toThrow(/_test/);
  });

  it('close() is idempotent', async () => {
    const extra = connectTestDatabase();
    await extra.close();
    await expect(extra.close()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 6: Run the test**

Run: `pnpm --filter @dropship/database test`
Expected: PASS (global setup applies the migration to `dropship_test` first). If it fails with a connection error, run `docker compose up -d` and check `TEST_DATABASE_URL` in `.env`.

- [ ] **Step 7: Build and commit**

```bash
pnpm --filter @dropship/database build
git add packages/database pnpm-lock.yaml
git commit -m "feat(database): add Drizzle schema, client, migrations and test helpers"
```

The auth schema is cross-checked against Better Auth's own generator in Task 9 Step 11, once Better Auth is installed.

---

### Task 5: `@dropship/database` — audit, integration-log and heartbeat repositories

**Files:**
- Create: `packages/database/src/repositories/audit.ts`, `src/repositories/integration-logs.ts`, `src/repositories/heartbeats.ts`, `src/repositories/index.ts`
- Modify: `packages/database/src/index.ts`
- Test: `packages/database/src/repositories/audit.test.ts`, `integration-logs.test.ts`, `heartbeats.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/database/src/repositories/audit.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDatabase, truncateAll } from '../testing';
import { listAuditEntries, recordAudit } from './audit';

describe('audit repository', () => {
  const handle = connectTestDatabase();
  beforeEach(() => truncateAll(handle.db));
  afterAll(() => handle.close());

  it('records entries and lists them newest first for an entity', async () => {
    await recordAudit(handle.db, {
      actorType: 'system',
      action: 'pricing_rule.created',
      entityType: 'pricing_rule',
      entityId: 'r1',
      after: { markup: '0.02' },
    });
    await recordAudit(handle.db, {
      actorType: 'system',
      action: 'pricing_rule.updated',
      entityType: 'pricing_rule',
      entityId: 'r1',
      before: { markup: '0.02' },
      after: { markup: '0.03' },
      correlationId: 'req-1',
    });
    await recordAudit(handle.db, { actorType: 'system', action: 'x', entityType: 'other' });

    const entries = await listAuditEntries(handle.db, { entityType: 'pricing_rule', entityId: 'r1' });
    expect(entries.map((e) => e.action)).toEqual(['pricing_rule.updated', 'pricing_rule.created']);
    expect(entries[0]).toMatchObject({
      before: { markup: '0.02' },
      after: { markup: '0.03' },
      correlationId: 'req-1',
    });
  });
});
```

`packages/database/src/repositories/integration-logs.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { integrationLogs } from '../schema';
import { connectTestDatabase, truncateAll } from '../testing';
import { withIntegrationLog } from './integration-logs';

describe('withIntegrationLog', () => {
  const handle = connectTestDatabase();
  beforeEach(() => truncateAll(handle.db));
  afterAll(() => handle.close());

  it('records a success with duration and returns the result', async () => {
    const result = await withIntegrationLog(
      handle.db,
      { provider: 'keepa', operation: 'product', accountRef: 'main' },
      async () => 42,
    );
    expect(result).toBe(42);
    const rows = await handle.db.select().from(integrationLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'keepa', operation: 'product', status: 'success' });
    expect(rows[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records an error and rethrows it', async () => {
    const failing = withIntegrationLog(handle.db, { provider: 'sp-api', operation: 'getOrders' }, async () => {
      throw Object.assign(new Error('boom'), { status: 503 });
    });
    await expect(failing).rejects.toThrow('boom');
    const rows = await handle.db.select().from(integrationLogs);
    expect(rows[0]).toMatchObject({ status: 'error', errorMessage: 'boom', httpStatus: 503 });
  });

  it('records 429 responses as throttled', async () => {
    const throttled = withIntegrationLog(handle.db, { provider: 'sp-api', operation: 'getOrders' }, async () => {
      throw Object.assign(new Error('Too Many Requests'), { status: 429 });
    });
    await expect(throttled).rejects.toThrow();
    const rows = await handle.db.select().from(integrationLogs);
    expect(rows[0]?.status).toBe('throttled');
  });
});
```

`packages/database/src/repositories/heartbeats.test.ts`:
```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDatabase, truncateAll } from '../testing';
import { listHeartbeats, pruneHeartbeats, recordHeartbeat } from './heartbeats';

describe('heartbeat repository', () => {
  const handle = connectTestDatabase();
  beforeEach(() => truncateAll(handle.db));
  afterAll(() => handle.close());

  it('upserts one row per worker group and instance', async () => {
    const startedAt = new Date('2026-01-01T00:00:00Z');
    await recordHeartbeat(handle.db, { workerGroup: 'system', instanceId: 'a', startedAt });
    await recordHeartbeat(handle.db, { workerGroup: 'system', instanceId: 'a', startedAt });
    await recordHeartbeat(handle.db, { workerGroup: 'system', instanceId: 'b', startedAt });
    const rows = await listHeartbeats(handle.db);
    expect(rows.map((r) => r.instanceId).sort()).toEqual(['a', 'b']);
  });

  it('prunes rows last seen before the cutoff', async () => {
    const startedAt = new Date();
    await recordHeartbeat(handle.db, {
      workerGroup: 'system',
      instanceId: 'old',
      startedAt,
      seenAt: new Date('2020-01-01T00:00:00Z'),
    });
    await recordHeartbeat(handle.db, { workerGroup: 'system', instanceId: 'new', startedAt });
    const deleted = await pruneHeartbeats(handle.db, new Date('2021-01-01T00:00:00Z'));
    expect(deleted).toBe(1);
    const rows = await listHeartbeats(handle.db);
    expect(rows.map((r) => r.instanceId)).toEqual(['new']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @dropship/database test`
Expected: FAIL — cannot find `./audit`, `./integration-logs`, `./heartbeats`.

- [ ] **Step 3: Implement the repositories**

`packages/database/src/repositories/audit.ts`:
```ts
import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { Database } from '../client';
import { auditLogs } from '../schema';

export interface AuditEntry {
  actorType: 'user' | 'system';
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  correlationId?: string | null;
}

export async function recordAudit(db: Database, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorType: entry.actorType,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    metadata: entry.metadata ?? null,
    correlationId: entry.correlationId ?? null,
  });
}

export async function listAuditEntries(
  db: Database,
  filter: { entityType: string; entityId?: string; limit?: number },
) {
  const conditions: SQL[] = [eq(auditLogs.entityType, filter.entityType)];
  if (filter.entityId) conditions.push(eq(auditLogs.entityId, filter.entityId));
  return db
    .select()
    .from(auditLogs)
    .where(and(...conditions))
    .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
    .limit(filter.limit ?? 50);
}
```

Note: Postgres `now()` is fixed per transaction, so two inserts in separate statements normally get distinct timestamps. If the ordering test is ever flaky, change the `occurredAt` default in `schema/ops.ts` to `sql\`clock_timestamp()\`` and generate a migration.

`packages/database/src/repositories/integration-logs.ts`:
```ts
import type { Database } from '../client';
import { integrationLogs } from '../schema';

export interface IntegrationCallMeta {
  provider: string;
  operation: string;
  accountRef?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
}

export interface IntegrationCallRecord extends IntegrationCallMeta {
  status: 'success' | 'error' | 'throttled';
  durationMs: number;
  httpStatus?: number;
  errorMessage?: string;
}

export async function recordIntegrationCall(db: Database, record: IntegrationCallRecord): Promise<void> {
  await db.insert(integrationLogs).values({
    provider: record.provider,
    operation: record.operation,
    accountRef: record.accountRef ?? null,
    status: record.status,
    httpStatus: record.httpStatus ?? null,
    durationMs: record.durationMs,
    errorMessage: record.errorMessage ?? null,
    correlationId: record.correlationId ?? null,
    details: record.details ?? null,
  });
}

function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };
  if (typeof status === 'number') return status;
  if (typeof statusCode === 'number') return statusCode;
  return undefined;
}

/** Times an external call, records the outcome, and returns or rethrows the call's result. */
export async function withIntegrationLog<T>(
  db: Database,
  meta: IntegrationCallMeta,
  call: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    const result = await call();
    await recordIntegrationCall(db, {
      ...meta,
      status: 'success',
      durationMs: Math.round(performance.now() - started),
    });
    return result;
  } catch (error) {
    const httpStatus = httpStatusOf(error);
    await recordIntegrationCall(db, {
      ...meta,
      status: httpStatus === 429 ? 'throttled' : 'error',
      httpStatus,
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - started),
    });
    throw error;
  }
}
```

`packages/database/src/repositories/heartbeats.ts`:
```ts
import { asc, lt } from 'drizzle-orm';
import type { Database } from '../client';
import { workerHeartbeats } from '../schema';

export async function recordHeartbeat(
  db: Database,
  input: { workerGroup: string; instanceId: string; startedAt: Date; seenAt?: Date },
): Promise<void> {
  const seenAt = input.seenAt ?? new Date();
  await db
    .insert(workerHeartbeats)
    .values({
      workerGroup: input.workerGroup,
      instanceId: input.instanceId,
      startedAt: input.startedAt,
      lastSeenAt: seenAt,
    })
    .onConflictDoUpdate({
      target: [workerHeartbeats.workerGroup, workerHeartbeats.instanceId],
      set: { lastSeenAt: seenAt, startedAt: input.startedAt },
    });
}

export async function listHeartbeats(db: Database) {
  return db
    .select()
    .from(workerHeartbeats)
    .orderBy(asc(workerHeartbeats.workerGroup), asc(workerHeartbeats.instanceId));
}

export async function pruneHeartbeats(db: Database, lastSeenBefore: Date): Promise<number> {
  const deleted = await db
    .delete(workerHeartbeats)
    .where(lt(workerHeartbeats.lastSeenAt, lastSeenBefore))
    .returning({ instanceId: workerHeartbeats.instanceId });
  return deleted.length;
}
```

`packages/database/src/repositories/index.ts`:
```ts
export * from './audit';
export * from './heartbeats';
export * from './integration-logs';
```

Modify `packages/database/src/index.ts`:
```ts
export * from './client';
export * from './migrate';
export * from './repositories';
export * from './schema';
```

- [ ] **Step 4: Run tests and build**

Run: `pnpm --filter @dropship/database test && pnpm --filter @dropship/database build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/database
git commit -m "feat(database): add audit, integration-log and heartbeat repositories"
```

---

### Task 6: `@dropship/queue` — queue names, Redis options, token-bucket rate limiter

**Files:**
- Create: `packages/queue/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`
- Create: `packages/queue/src/names.ts`, `src/redis.ts`, `src/rate-limiter.ts`, `src/index.ts`
- Test: `packages/queue/src/redis.test.ts`, `src/rate-limiter.test.ts`

- [ ] **Step 1: Create the package skeleton**

`packages/queue/package.json`:
```json
{
  "name": "@dropship/queue",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

`packages/queue/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/queue/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/queue/vitest.config.ts`:
```ts
import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: { fileParallelism: false, testTimeout: 20_000 },
});
```

```bash
pnpm --filter @dropship/queue add ioredis
pnpm --filter @dropship/queue add -D vitest typescript @types/node
```

- [ ] **Step 2: Write the failing tests**

`packages/queue/src/redis.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { redisOptionsFromUrl } from './redis';

describe('redisOptionsFromUrl', () => {
  it('parses host, port, credentials and db', () => {
    const options = redisOptionsFromUrl('redis://default:p%40ss@redis.railway.internal:6380/2');
    expect(options).toMatchObject({
      host: 'redis.railway.internal',
      port: 6380,
      username: 'default',
      password: 'p@ss',
      db: 2,
      family: 0,
      maxRetriesPerRequest: null,
    });
    expect(options.tls).toBeUndefined();
  });

  it('defaults port and db and enables TLS for rediss://', () => {
    const options = redisOptionsFromUrl('rediss://example.com');
    expect(options).toMatchObject({ port: 6379, db: 0 });
    expect(options.tls).toEqual({});
  });

  it('rejects non-redis protocols', () => {
    expect(() => redisOptionsFromUrl('http://example.com')).toThrow(/protocol/);
  });
});
```

`packages/queue/src/rate-limiter.test.ts`:
```ts
import { Redis } from 'ioredis';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTokenBucketLimiter, RateLimitTimeoutError } from './rate-limiter';
import { redisOptionsFromUrl } from './redis';

const url = process.env.TEST_REDIS_URL;
if (!url) throw new Error('TEST_REDIS_URL must be set');
const redis = new Redis(redisOptionsFromUrl(url));
const limiter = createTokenBucketLimiter(redis, { keyPrefix: 'test-ratelimit' });

describe('token bucket limiter', () => {
  beforeEach(async () => {
    await redis.flushdb();
  });
  afterAll(async () => {
    await redis.quit();
  });

  it('allows up to capacity, then denies with a retry delay', async () => {
    const rule = { capacity: 3, refillPerSecond: 1 };
    for (let i = 0; i < 3; i++) {
      expect((await limiter.tryAcquire('sp-api:A1:getOrders', rule)).allowed).toBe(true);
    }
    const denied = await limiter.tryAcquire('sp-api:A1:getOrders', rule);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it('keeps separate buckets per key', async () => {
    const rule = { capacity: 1, refillPerSecond: 1 };
    expect((await limiter.tryAcquire('sp-api:A1:getOrders', rule)).allowed).toBe(true);
    expect((await limiter.tryAcquire('sp-api:A2:getOrders', rule)).allowed).toBe(true);
  });

  it('acquire() waits for a token to refill', async () => {
    const rule = { capacity: 1, refillPerSecond: 20 };
    await limiter.acquire('keepa:main:product', rule);
    const started = Date.now();
    await limiter.acquire('keepa:main:product', rule);
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });

  it('acquire() gives up after maxWaitMs', async () => {
    const rule = { capacity: 1, refillPerSecond: 0.1 };
    await limiter.acquire('slow:key', rule);
    await expect(limiter.acquire('slow:key', rule, { maxWaitMs: 100 })).rejects.toBeInstanceOf(
      RateLimitTimeoutError,
    );
  });

  it('rejects requests larger than the bucket', async () => {
    await expect(limiter.tryAcquire('k', { capacity: 1, refillPerSecond: 1 }, 2)).rejects.toThrow(
      RangeError,
    );
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @dropship/queue test`
Expected: FAIL — cannot find `./redis` / `./rate-limiter`.

- [ ] **Step 4: Implement**

`packages/queue/src/names.ts`:
```ts
/** Every BullMQ key is namespaced under this prefix. */
export const BULL_PREFIX = 'dropship';

export const QUEUE_NAMES = {
  system: 'system',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const SYSTEM_JOBS = {
  pruneHeartbeats: 'prune-heartbeats',
} as const;

/** Workers write a heartbeat this often; the API marks a worker stale after 3 missed beats. */
export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;
```

`packages/queue/src/redis.ts`:
```ts
import type { RedisOptions } from 'ioredis';

/**
 * Converts a redis:// or rediss:// URL to ioredis options suitable for BullMQ.
 * family: 0 lets ioredis resolve IPv6 addresses (Railway private networking).
 * maxRetriesPerRequest: null is required by BullMQ workers.
 */
export function redisOptionsFromUrl(url: string): RedisOptions {
  const parsed = new URL(url);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`Unsupported Redis URL protocol: ${parsed.protocol}`);
  }
  const dbPath = parsed.pathname.replace(/^\//, '');
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: dbPath ? Number(dbPath) : 0,
    family: 0,
    maxRetriesPerRequest: null,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
```

`packages/queue/src/rate-limiter.ts` (the bucket logic runs as a Redis Lua script registered with ioredis `defineCommand`, which caches it server-side and calls it by SHA):
```ts
import type { Redis } from 'ioredis';

// Token bucket stored as a Redis hash. Uses Redis TIME so all callers share one clock.
// Returns { allowed (0|1), retryAfterMs }.
const TOKEN_BUCKET_LUA = `
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local requested = tonumber(ARGV[3])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end
tokens = math.min(capacity, tokens + (math.max(0, now - ts) / 1000) * rate)
local allowed = 0
local retry_after = 0
if tokens >= requested then
  tokens = tokens - requested
  allowed = 1
else
  retry_after = math.ceil(((requested - tokens) / rate) * 1000)
end
redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'ts', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil((capacity / rate) * 1000) + 1000)
return { allowed, retry_after }
`;

const COMMAND = 'dropshipTokenBucket';

type RedisWithTokenBucket = Redis & {
  [COMMAND](key: string, capacity: number, refillPerSecond: number, tokens: number): Promise<[number, number]>;
};

export interface TokenBucketRule {
  /** Maximum burst size. */
  capacity: number;
  /** Sustained rate. Use the provider's documented rate, e.g. SP-API getOrders = 0.0167. */
  refillPerSecond: number;
}

export interface AcquireResult {
  allowed: boolean;
  retryAfterMs: number;
}

export class RateLimitTimeoutError extends Error {
  constructor(
    readonly key: string,
    readonly maxWaitMs: number,
  ) {
    super(`Rate limit wait for "${key}" would exceed ${maxWaitMs}ms`);
    this.name = 'RateLimitTimeoutError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Shared limiter for provider calls. Key convention: `${provider}:${accountRef}:${operation}`,
 * e.g. `sp-api:A1B2C3:getItemOffers` or `keepa:main:product`.
 */
export function createTokenBucketLimiter(redis: Redis, options: { keyPrefix?: string } = {}) {
  const prefix = options.keyPrefix ?? 'ratelimit';
  if (!(COMMAND in redis)) {
    redis.defineCommand(COMMAND, { numberOfKeys: 1, lua: TOKEN_BUCKET_LUA });
  }
  const client = redis as RedisWithTokenBucket;

  async function tryAcquire(key: string, rule: TokenBucketRule, tokens = 1): Promise<AcquireResult> {
    if (tokens > rule.capacity) {
      throw new RangeError(`Requested ${tokens} tokens but bucket capacity is ${rule.capacity}`);
    }
    const [allowed, retryAfterMs] = await client[COMMAND](
      `${prefix}:${key}`,
      rule.capacity,
      rule.refillPerSecond,
      tokens,
    );
    return { allowed: allowed === 1, retryAfterMs };
  }

  async function acquire(
    key: string,
    rule: TokenBucketRule,
    opts: { tokens?: number; maxWaitMs?: number } = {},
  ): Promise<void> {
    const maxWaitMs = opts.maxWaitMs ?? 30_000;
    const started = Date.now();
    for (;;) {
      const result = await tryAcquire(key, rule, opts.tokens ?? 1);
      if (result.allowed) return;
      if (Date.now() - started + result.retryAfterMs > maxWaitMs) {
        throw new RateLimitTimeoutError(key, maxWaitMs);
      }
      await sleep(result.retryAfterMs);
    }
  }

  return { tryAcquire, acquire };
}

export type TokenBucketLimiter = ReturnType<typeof createTokenBucketLimiter>;
```

`packages/queue/src/index.ts`:
```ts
export * from './names';
export * from './rate-limiter';
export * from './redis';
```

- [ ] **Step 5: Run tests and build**

Run: `pnpm --filter @dropship/queue test && pnpm --filter @dropship/queue build`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/queue pnpm-lock.yaml
git commit -m "feat(queue): add queue names, Redis URL parsing and token-bucket rate limiter"
```

---

### Task 7: `@dropship/nest-common` — Nest Database and Redis modules

**Files:**
- Create: `packages/nest-common/package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`
- Create: `packages/nest-common/src/database.module.ts`, `src/redis.module.ts`, `src/index.ts`
- Test: `packages/nest-common/src/modules.test.ts`

- [ ] **Step 1: Create the package skeleton**

`packages/nest-common/package.json`:
```json
{
  "name": "@dropship/nest-common",
  "version": "0.0.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

`packages/nest-common/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.nest.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/nest-common/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts"]
}
```

`packages/nest-common/vitest.config.ts` (SWC is required: Vitest's default esbuild transform does not emit decorator metadata, which Nest DI needs):
```ts
import { existsSync } from 'node:fs';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: { fileParallelism: false, testTimeout: 20_000 },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
```

```bash
pnpm --filter @dropship/nest-common add @nestjs/common @nestjs/core reflect-metadata rxjs ioredis drizzle-orm @dropship/database@workspace:* @dropship/queue@workspace:*
pnpm --filter @dropship/nest-common add -D @nestjs/testing vitest unplugin-swc @swc/core typescript @types/node
```

- [ ] **Step 2: Write the failing test**

`packages/nest-common/src/modules.test.ts`:
```ts
import 'reflect-metadata';
import type { Database, DatabaseHandle } from '@dropship/database';
import { assertTestDatabaseUrl } from '@dropship/database/testing';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { DATABASE, DATABASE_HANDLE, DatabaseModule } from './database.module';
import { REDIS, RedisModule } from './redis.module';

describe('DatabaseModule and RedisModule', () => {
  it('provide working clients and close them on shutdown', async () => {
    const redisUrl = process.env.TEST_REDIS_URL;
    if (!redisUrl) throw new Error('TEST_REDIS_URL must be set');
    const app = await Test.createTestingModule({
      imports: [
        DatabaseModule.forRoot(assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)),
        RedisModule.forRoot(redisUrl),
      ],
    }).compile();
    await app.init();

    const db = app.get<Database>(DATABASE);
    const result = await db.execute(sql`select 1 as one`);
    expect(result.rows[0]).toEqual({ one: 1 });

    const redis = app.get<Redis>(REDIS);
    expect(await redis.ping()).toBe('PONG');

    const handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    await app.close();
    expect(handle.pool.ended).toBe(true);
    expect(redis.status).toBe('end');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @dropship/nest-common test`
Expected: FAIL — cannot find `./database.module`.

- [ ] **Step 4: Implement**

`packages/nest-common/src/database.module.ts`:
```ts
import { createDatabase, type DatabaseHandle } from '@dropship/database';
import {
  type DynamicModule,
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';

export const DATABASE = Symbol('DATABASE');
export const DATABASE_HANDLE = Symbol('DATABASE_HANDLE');

@Global()
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_HANDLE) private readonly handle: DatabaseHandle) {}

  static forRoot(url: string, options: { maxConnections?: number } = {}): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        { provide: DATABASE_HANDLE, useFactory: () => createDatabase(url, options) },
        {
          provide: DATABASE,
          useFactory: (handle: DatabaseHandle) => handle.db,
          inject: [DATABASE_HANDLE],
        },
      ],
      exports: [DATABASE, DATABASE_HANDLE],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
```

`packages/nest-common/src/redis.module.ts`:
```ts
import { redisOptionsFromUrl } from '@dropship/queue';
import {
  type DynamicModule,
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

@Global()
@Module({})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** lazyConnect: the first command opens the connection, so building the app never blocks on Redis. */
  static forRoot(url: string): DynamicModule {
    return {
      module: RedisModule,
      providers: [
        {
          provide: REDIS,
          useFactory: () => new Redis({ ...redisOptionsFromUrl(url), lazyConnect: true }),
        },
      ],
      exports: [REDIS],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') {
      await this.redis.quit();
      return;
    }
    this.redis.disconnect();
  }
}
```

`packages/nest-common/src/index.ts`:
```ts
export * from './database.module';
export * from './redis.module';
```

- [ ] **Step 5: Run tests and build**

Run: `pnpm --filter @dropship/nest-common test && pnpm --filter @dropship/nest-common build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/nest-common pnpm-lock.yaml
git commit -m "feat(nest-common): add Nest database and Redis modules"
```

---

### Task 8: API bootstrap — Fastify, config, logging, health, Swagger, Sentry

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `vitest.config.ts`
- Create: `apps/api/src/instrument.ts`, `src/main.ts`, `src/app.factory.ts`, `src/app.module.ts`, `src/swagger.ts`
- Create: `apps/api/src/config/api-config.module.ts`
- Create: `apps/api/src/auth/public.decorator.ts`
- Create: `apps/api/src/health/health.controller.ts`, `src/health/health.module.ts`
- Create: `apps/api/test/global-setup.ts`, `test/test-env.ts`
- Test: `apps/api/test/health.e2e.test.ts`

- [ ] **Step 1: Create the app skeleton**

`apps/api/package.json`:
```json
{
  "name": "@dropship/api",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "node dist/main.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "user:create": "node dist/scripts/create-user.js",
    "openapi:export": "node dist/scripts/export-openapi.js"
  }
}
```

`apps/api/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.nest.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src", "test"]
}
```

`apps/api/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "src" },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`apps/api/nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "tsConfigPath": "tsconfig.build.json",
    "deleteOutDir": true
  }
}
```

`apps/api/vitest.config.ts`:
```ts
import { existsSync } from 'node:fs';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
```

```bash
pnpm --filter @dropship/api add @nestjs/common @nestjs/core @nestjs/platform-fastify @nestjs/swagger @fastify/static fastify reflect-metadata rxjs drizzle-orm ioredis bullmq @sentry/nestjs @dropship/config@workspace:* @dropship/observability@workspace:* @dropship/database@workspace:* @dropship/queue@workspace:* @dropship/nest-common@workspace:*
pnpm --filter @dropship/api add -D @nestjs/cli @nestjs/schematics @nestjs/testing vitest unplugin-swc @swc/core typescript @types/node
```

- [ ] **Step 2: Write the failing health test and test helpers**

`apps/api/test/global-setup.ts`:
```ts
import { prepareTestDatabase } from '@dropship/database/testing';

export default async function setup() {
  await prepareTestDatabase();
}
```

`apps/api/test/test-env.ts`:
```ts
import { type ApiEnv, apiEnvSchema, parseEnv } from '@dropship/config';
import { assertTestDatabaseUrl } from '@dropship/database/testing';

export function testApiEnv(overrides: Record<string, string> = {}): ApiEnv {
  return parseEnv(apiEnvSchema, {
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL),
    REDIS_URL: process.env.TEST_REDIS_URL,
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123456',
    BETTER_AUTH_URL: 'http://localhost:3000',
    WEB_ORIGIN: 'http://localhost:3000',
    REQUIRE_2FA: 'false',
    ...overrides,
  });
}
```

`apps/api/test/health.e2e.test.ts`:
```ts
import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.factory';
import { testApiEnv } from './test-env';

describe('health endpoints', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp(testApiEnv());
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health/live returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /api/health/ready checks database and redis', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('echoes the x-request-id header for correlation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health/live',
      headers: { 'x-request-id': 'corr-123' },
    });
    expect(res.headers['x-request-id']).toBe('corr-123');
  });

  it('reports not ready when Redis is unreachable', async () => {
    const broken = await createApp(testApiEnv({ REDIS_URL: 'redis://127.0.0.1:1/0' }));
    try {
      const res = await broken.inject({ method: 'GET', url: '/api/health/ready' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ checks: { database: 'ok', redis: 'error' } });
    } finally {
      await broken.close();
    }
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @dropship/api test`
Expected: FAIL — cannot find `../src/app.factory`.

- [ ] **Step 4: Implement the bootstrap**

`apps/api/src/config/api-config.module.ts`:
```ts
import type { ApiEnv } from '@dropship/config';
import { type DynamicModule, Global, Module } from '@nestjs/common';

export const API_ENV = Symbol('API_ENV');

@Global()
@Module({})
export class ApiConfigModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: ApiConfigModule,
      providers: [{ provide: API_ENV, useValue: env }],
      exports: [API_ENV],
    };
  }
}
```

`apps/api/src/auth/public.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';

/** Marks a route as reachable without a session. Everything else requires one. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
```

`apps/api/src/health/health.controller.ts`:
```ts
import type { Database } from '@dropship/database';
import { DATABASE, REDIS } from '@dropship/nest-common';
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { Public } from '../auth/public.decorator';

type CheckResult = 'ok' | 'error';

const CHECK_TIMEOUT_MS = 2_000;

async function check(fn: () => Promise<unknown>): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready() {
    const checks = {
      database: await check(() => this.db.execute(sql`select 1`)),
      redis: await check(() => this.redis.ping()),
    };
    if (Object.values(checks).some((result) => result !== 'ok')) {
      throw new ServiceUnavailableException({ status: 'error', checks });
    }
    return { status: 'ok', checks };
  }
}
```

`apps/api/src/health/health.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

`apps/api/src/app.module.ts`:
```ts
import type { ApiEnv } from '@dropship/config';
import { DatabaseModule, RedisModule } from '@dropship/nest-common';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { ApiConfigModule } from './config/api-config.module';
import { HealthModule } from './health/health.module';

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        SentryModule.forRoot(),
        ApiConfigModule.forRoot(env),
        DatabaseModule.forRoot(env.DATABASE_URL),
        RedisModule.forRoot(env.REDIS_URL),
        HealthModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
    };
  }
}
```

`apps/api/src/swagger.ts`:
```ts
import type { ApiEnv } from '@dropship/config';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Dropship Platform API')
    .setVersion('0.1.0')
    .addCookieAuth('better-auth.session_token')
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Interactive docs at /api/docs, outside production only. */
export function setupSwagger(app: INestApplication, env: ApiEnv): void {
  if (env.APP_ENV === 'production') return;
  SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));
}
```

`apps/api/src/app.factory.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { ApiEnv } from '@dropship/config';
import { createLoggerOptions } from '@dropship/observability';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';

export async function createApp(env: ApiEnv): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: createLoggerOptions({ service: 'api', level: env.LOG_LEVEL, appEnv: env.APP_ENV }),
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env), adapter, {
    logger: env.LOG_LEVEL === 'silent' ? false : undefined,
  });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (request, reply) => {
      reply.header('x-request-id', request.id);
    });
  setupSwagger(app, env);
  await app.init();
  return app;
}
```

`apps/api/src/instrument.ts` (imported first by `main.ts` so Sentry can instrument everything loaded after it):
```ts
import { loadDotEnv } from '@dropship/config';
import * as Sentry from '@sentry/nestjs';

loadDotEnv();

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.APP_ENV ?? 'development',
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
```

`apps/api/src/main.ts`:
```ts
import './instrument';
import 'reflect-metadata';
import { apiEnvSchema, parseEnv } from '@dropship/config';
import { createApp } from './app.factory';

async function bootstrap() {
  const env = parseEnv(apiEnvSchema);
  const app = await createApp(env);
  // '::' listens on IPv6 and IPv4; Railway private networking uses IPv6.
  await app.listen(env.PORT, '::');
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @dropship/api test`
Expected: 4 tests PASS. The Redis-unreachable test may log connection errors; that is expected.

- [ ] **Step 6: Build and smoke-test the server**

```bash
pnpm build
pnpm db:migrate
pnpm --filter @dropship/api start
```
In another terminal: `curl http://localhost:3000/api/health/ready`
Expected: `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`. Open `http://localhost:3000/api/docs` and see the Swagger UI. Stop the server with Ctrl+C and confirm it exits cleanly.

- [ ] **Step 7: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): bootstrap NestJS/Fastify API with health checks, Swagger and Sentry"
```

---

### Task 9: Authentication — Better Auth, session guard, roles, 2FA enforcement, user creation

**Files:**
- Create: `apps/api/src/auth/roles.ts`, `src/auth/auth.ts`, `src/auth/auth.tokens.ts`, `src/auth/register-auth-routes.ts`
- Create: `apps/api/src/auth/roles.decorator.ts`, `src/auth/current-user.decorator.ts`, `src/auth/session.guard.ts`
- Create: `apps/api/src/auth/create-user.ts`, `src/auth/me.dto.ts`, `src/auth/me.controller.ts`, `src/auth/auth.module.ts`
- Create: `apps/api/src/scripts/create-user.ts`
- Create: `apps/api/test/auth-helpers.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/app.factory.ts`
- Test: `apps/api/src/auth/session.guard.test.ts`, `apps/api/test/auth.e2e.test.ts`

- [ ] **Step 1: Install Better Auth**

```bash
pnpm --filter @dropship/api add better-auth
```

- [ ] **Step 2: Write the failing guard unit tests**

`apps/api/src/auth/session.guard.test.ts`:
```ts
import 'reflect-metadata';
import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { Public } from './public.decorator';
import { Roles } from './roles.decorator';
import { type AuthenticatedUser, SessionGuard, type SessionReader } from './session.guard';

class TestController {
  @Public()
  open() {}
  anyUser() {}
  @Roles('admin')
  adminOnly() {}
}

function contextFor(method: keyof TestController, request: object): ExecutionContext {
  return {
    getHandler: () => TestController.prototype[method],
    getClass: () => TestController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function readerReturning(user: Record<string, unknown> | null): SessionReader {
  return {
    api: {
      getSession: vi.fn().mockResolvedValue(user ? { user, session: { id: 's1' } } : null),
    },
  };
}

const operator = {
  id: 'u1',
  email: 'op@example.com',
  name: 'Op',
  role: 'operator',
  twoFactorEnabled: true,
};

function guard(reader: SessionReader, require2fa = true) {
  return new SessionGuard(new Reflector(), reader, { REQUIRE_2FA: require2fa });
}

type TestRequest = { headers: object; user?: AuthenticatedUser };

describe('SessionGuard', () => {
  it('allows public routes without reading the session', async () => {
    const reader = readerReturning(null);
    await expect(guard(reader).canActivate(contextFor('open', { headers: {} }))).resolves.toBe(true);
    expect(reader.api.getSession).not.toHaveBeenCalled();
  });

  it('rejects requests without a session', async () => {
    await expect(
      guard(readerReturning(null)).canActivate(contextFor('anyUser', { headers: {} })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('requires 2FA when REQUIRE_2FA is on', async () => {
    const promise = guard(readerReturning({ ...operator, twoFactorEnabled: false })).canActivate(
      contextFor('anyUser', { headers: {} }),
    );
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(promise).rejects.toMatchObject({
      response: { code: 'TWO_FACTOR_SETUP_REQUIRED' },
    });
  });

  it('skips the 2FA requirement when REQUIRE_2FA is off', async () => {
    const request: TestRequest = { headers: {} };
    await expect(
      guard(readerReturning({ ...operator, twoFactorEnabled: false }), false).canActivate(
        contextFor('anyUser', request),
      ),
    ).resolves.toBe(true);
  });

  it('enforces @Roles', async () => {
    await expect(
      guard(readerReturning(operator)).canActivate(contextFor('adminOnly', { headers: {} })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('attaches the authenticated user to the request', async () => {
    const request: TestRequest = { headers: {} };
    await guard(readerReturning(operator)).canActivate(contextFor('anyUser', request));
    expect(request.user).toEqual({
      id: 'u1',
      email: 'op@example.com',
      name: 'Op',
      role: 'operator',
      twoFactorEnabled: true,
    });
  });

  it('treats users without a known role as viewers', async () => {
    const request: TestRequest = { headers: {} };
    await guard(readerReturning({ ...operator, role: 'superuser' })).canActivate(
      contextFor('anyUser', request),
    );
    expect(request.user?.role).toBe('viewer');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @dropship/api test -- src/auth/session.guard.test.ts`
Expected: FAIL — cannot find `./roles.decorator` / `./session.guard`.

- [ ] **Step 4: Implement roles, decorators and the guard**

`apps/api/src/auth/roles.ts`:
```ts
export const ROLES = ['admin', 'operator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export function toRole(value: unknown): Role {
  return ROLES.includes(value as Role) ? (value as Role) : 'viewer';
}
```

`apps/api/src/auth/roles.decorator.ts`:
```ts
import { SetMetadata } from '@nestjs/common';
import type { Role } from './roles';

export const ROLES_KEY = 'roles';

/** Restricts a route to the listed roles. Without it, any signed-in user may call the route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

`apps/api/src/auth/auth.tokens.ts`:
```ts
export const AUTH = Symbol('AUTH');
```

`apps/api/src/auth/session.guard.ts`:
```ts
import type { IncomingHttpHeaders } from 'node:http';
import type { ApiEnv } from '@dropship/config';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { API_ENV } from '../config/api-config.module';
import { AUTH } from './auth.tokens';
import { IS_PUBLIC } from './public.decorator';
import { type Role, toRole } from './roles';
import { ROLES_KEY } from './roles.decorator';

/** The slice of Better Auth the guard needs. Narrow on purpose so tests can fake it. */
export interface SessionReader {
  api: {
    getSession(input: { headers: Headers }): Promise<{
      user: Record<string, unknown> & { id: string; email: string; name: string };
      session: unknown;
    } | null>;
  };
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  twoFactorEnabled: boolean;
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH) private readonly auth: SessionReader,
    @Inject(API_ENV) private readonly env: Pick<ApiEnv, 'REQUIRE_2FA'>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context
      .switchToHttp()
      .getRequest<{ headers: IncomingHttpHeaders; user?: AuthenticatedUser }>();
    const result = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!result) throw new UnauthorizedException();

    const user: AuthenticatedUser = {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: toRole(result.user.role),
      twoFactorEnabled: result.user.twoFactorEnabled === true,
    };

    if (this.env.REQUIRE_2FA && !user.twoFactorEnabled) {
      throw new ForbiddenException({
        code: 'TWO_FACTOR_SETUP_REQUIRED',
        message: 'Two-factor authentication must be enabled before using the platform',
      });
    }

    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (required && !required.includes(user.role)) throw new ForbiddenException();

    request.user = user;
    return true;
  }
}
```

`apps/api/src/auth/current-user.decorator.ts`:
```ts
import { createParamDecorator, type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedUser } from './session.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    if (!request.user) throw new UnauthorizedException();
    return request.user;
  },
);
```

- [ ] **Step 5: Run guard tests**

Run: `pnpm --filter @dropship/api test -- src/auth/session.guard.test.ts`
Expected: 7 PASS.

- [ ] **Step 6: Write the failing auth end-to-end test and helper**

`apps/api/test/auth-helpers.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { ApiEnv } from '@dropship/config';
import type { Database } from '@dropship/database';
import { DATABASE } from '@dropship/nest-common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createUserWithRole } from '../src/auth/create-user';
import type { Role } from '../src/auth/roles';

export const TEST_PASSWORD = 'correct-horse-battery-staple';

/** Creates a user with the role, signs in through the real HTTP endpoint, returns a Cookie header. */
export async function signInAs(app: NestFastifyApplication, env: ApiEnv, role: Role): Promise<string> {
  const db = app.get<Database>(DATABASE);
  const email = `${role}-${randomUUID()}@test.local`;
  await createUserWithRole({ db, env }, { email, password: TEST_PASSWORD, name: role, role });
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email',
    headers: { 'content-type': 'application/json', origin: env.WEB_ORIGIN },
    payload: { email, password: TEST_PASSWORD },
  });
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
  const raw = res.headers['set-cookie'];
  const cookies = (Array.isArray(raw) ? raw : [raw]).filter((c): c is string => typeof c === 'string');
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}
```

`apps/api/test/auth.e2e.test.ts`:
```ts
import 'reflect-metadata';
import type { ApiEnv } from '@dropship/config';
import { auditLogs, type Database } from '@dropship/database';
import { truncateAll } from '@dropship/database/testing';
import { DATABASE } from '@dropship/nest-common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.factory';
import { createUserWithRole } from '../src/auth/create-user';
import { signInAs, TEST_PASSWORD } from './auth-helpers';
import { testApiEnv } from './test-env';

describe('authentication', () => {
  let app: NestFastifyApplication;
  let env: ApiEnv;
  let db: Database;

  beforeAll(async () => {
    env = testApiEnv();
    app = await createApp(env);
    db = app.get(DATABASE);
  });
  beforeEach(() => truncateAll(db));
  afterAll(async () => {
    await app.close();
  });

  it('GET /api/me returns 401 without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
  });

  it('signs in and returns the current user with role', async () => {
    const cookie = await signInAs(app, env, 'operator');
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ role: 'operator', twoFactorEnabled: false });
  });

  it('public sign-up is disabled', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'content-type': 'application/json', origin: env.WEB_ORIGIN },
      payload: { email: 'new@test.local', password: TEST_PASSWORD, name: 'New' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('audits user creation and session creation', async () => {
    await signInAs(app, env, 'viewer');
    const actions = (await db.select().from(auditLogs)).map((row) => row.action).sort();
    expect(actions).toEqual(['auth.session_created', 'user.created']);
  });

  it('createUserWithRole updates the role of an existing user instead of failing', async () => {
    const input = {
      email: 'Same@Test.local',
      password: TEST_PASSWORD,
      name: 'Same',
      role: 'viewer' as const,
    };
    const first = await createUserWithRole({ db, env }, input);
    const second = await createUserWithRole({ db, env }, { ...input, role: 'admin' });
    expect(first.created).toBe(true);
    expect(second).toEqual({ userId: first.userId, created: false });
    const audits = await db.select().from(auditLogs).where(eq(auditLogs.action, 'user.role_set'));
    expect(audits[0]?.after).toEqual({ role: 'admin' });
  });

  it('requires 2FA setup when REQUIRE_2FA is on', async () => {
    const strictEnv = testApiEnv({ REQUIRE_2FA: 'true' });
    const strict = await createApp(strictEnv);
    try {
      const cookie = await signInAs(strict, strictEnv, 'operator');
      const res = await strict.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: 'TWO_FACTOR_SETUP_REQUIRED' });
    } finally {
      await strict.close();
    }
  });
});
```

- [ ] **Step 7: Run to verify failure**

Run: `pnpm --filter @dropship/api test -- test/auth.e2e.test.ts`
Expected: FAIL — cannot find `../src/auth/create-user`.

- [ ] **Step 8: Implement Better Auth, routes, user creation, `/api/me`**

`apps/api/src/auth/auth.ts`:
```ts
import { authSchema, type Database, recordAudit } from '@dropship/database';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, twoFactor } from 'better-auth/plugins';

export interface CreateAuthOptions {
  db: Database;
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  /** Only the create-user script enables sign-up. The HTTP API never does. */
  allowSignUp?: boolean;
}

export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    appName: 'Dropship Platform',
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: '/api/auth',
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(options.db, { provider: 'pg', schema: authSchema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: !options.allowSignUp,
      autoSignIn: false,
      minPasswordLength: 12,
    },
    plugins: [admin({ defaultRole: 'viewer', adminRoles: ['admin'] }), twoFactor()],
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await recordAudit(options.db, {
              actorType: 'user',
              actorUserId: session.userId,
              action: 'auth.session_created',
              entityType: 'session',
              entityId: session.id,
              metadata: { ipAddress: session.ipAddress ?? null },
            });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
```

`autoSignIn: false` stops the create-user path from opening a session (and writing an extra `auth.session_created` audit row) when it calls `signUpEmail`.

`apps/api/src/auth/register-auth-routes.ts` (Better Auth's Fastify integration, adapted to forward multiple `Set-Cookie` headers correctly):
```ts
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { Auth } from './auth';

/** Mounts Better Auth at /api/auth/* directly on Fastify, outside Nest's guards. */
export function registerAuthRoutes(app: NestFastifyApplication, auth: Auth): void {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const url = new URL(request.url, `${request.protocol}://${request.host}`);
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
```

`apps/api/src/auth/create-user.ts`:
```ts
import type { ApiEnv } from '@dropship/config';
import { type Database, recordAudit, user } from '@dropship/database';
import { eq } from 'drizzle-orm';
import { createAuth } from './auth';
import type { Role } from './roles';

export interface CreateUserInput {
  email: string;
  password: string;
  name: string;
  role: Role;
}

/**
 * Creates a user with a role, or updates the role if the email already exists.
 * Used by the create-user script and tests. Self-service sign-up stays disabled.
 */
export async function createUserWithRole(
  deps: {
    db: Database;
    env: Pick<ApiEnv, 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL' | 'WEB_ORIGIN'>;
  },
  input: CreateUserInput,
): Promise<{ userId: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const existing = await deps.db.query.user.findFirst({ where: eq(user.email, email) });
  if (existing) {
    await deps.db.update(user).set({ role: input.role }).where(eq(user.id, existing.id));
    await recordAudit(deps.db, {
      actorType: 'system',
      action: 'user.role_set',
      entityType: 'user',
      entityId: existing.id,
      before: { role: existing.role },
      after: { role: input.role },
    });
    return { userId: existing.id, created: false };
  }

  const auth = createAuth({
    db: deps.db,
    secret: deps.env.BETTER_AUTH_SECRET,
    baseURL: deps.env.BETTER_AUTH_URL,
    trustedOrigins: [deps.env.WEB_ORIGIN],
    allowSignUp: true,
  });
  const result = await auth.api.signUpEmail({
    body: { email, password: input.password, name: input.name },
  });
  await deps.db
    .update(user)
    .set({ role: input.role, emailVerified: true })
    .where(eq(user.id, result.user.id));
  await recordAudit(deps.db, {
    actorType: 'system',
    action: 'user.created',
    entityType: 'user',
    entityId: result.user.id,
    after: { email, role: input.role },
  });
  return { userId: result.user.id, created: true };
}
```

`apps/api/src/auth/me.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { ROLES, type Role } from './roles';

export class MeDto {
  @ApiProperty() id: string;
  @ApiProperty() email: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: ROLES }) role: Role;
  @ApiProperty() twoFactorEnabled: boolean;
}
```

`apps/api/src/auth/me.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from './current-user.decorator';
import { MeDto } from './me.dto';
import type { AuthenticatedUser } from './session.guard';

@ApiTags('auth')
@Controller('me')
export class MeController {
  @Get()
  @ApiOkResponse({ type: MeDto })
  me(@CurrentUser() user: AuthenticatedUser): MeDto {
    return user;
  }
}
```

`apps/api/src/auth/auth.module.ts`:
```ts
import type { ApiEnv } from '@dropship/config';
import type { Database } from '@dropship/database';
import { DATABASE } from '@dropship/nest-common';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { API_ENV } from '../config/api-config.module';
import { createAuth } from './auth';
import { AUTH } from './auth.tokens';
import { MeController } from './me.controller';
import { SessionGuard } from './session.guard';

@Module({
  controllers: [MeController],
  providers: [
    {
      provide: AUTH,
      inject: [DATABASE, API_ENV],
      useFactory: (db: Database, env: ApiEnv) =>
        createAuth({
          db,
          secret: env.BETTER_AUTH_SECRET,
          baseURL: env.BETTER_AUTH_URL,
          trustedOrigins: [env.WEB_ORIGIN],
        }),
    },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [AUTH],
})
export class AuthModule {}
```

Replace `apps/api/src/app.module.ts` with:
```ts
import type { ApiEnv } from '@dropship/config';
import { DatabaseModule, RedisModule } from '@dropship/nest-common';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { AuthModule } from './auth/auth.module';
import { ApiConfigModule } from './config/api-config.module';
import { HealthModule } from './health/health.module';

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        SentryModule.forRoot(),
        ApiConfigModule.forRoot(env),
        DatabaseModule.forRoot(env.DATABASE_URL),
        RedisModule.forRoot(env.REDIS_URL),
        HealthModule,
        AuthModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
    };
  }
}
```

Replace `apps/api/src/app.factory.ts` with:
```ts
import { randomUUID } from 'node:crypto';
import type { ApiEnv } from '@dropship/config';
import { createLoggerOptions } from '@dropship/observability';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import type { Auth } from './auth/auth';
import { AUTH } from './auth/auth.tokens';
import { registerAuthRoutes } from './auth/register-auth-routes';
import { setupSwagger } from './swagger';

export async function createApp(env: ApiEnv): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: createLoggerOptions({ service: 'api', level: env.LOG_LEVEL, appEnv: env.APP_ENV }),
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env), adapter, {
    logger: env.LOG_LEVEL === 'silent' ? false : undefined,
  });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (request, reply) => {
      reply.header('x-request-id', request.id);
    });
  registerAuthRoutes(app, app.get<Auth>(AUTH));
  setupSwagger(app, env);
  await app.init();
  return app;
}
```

- [ ] **Step 9: Add the create-user script**

`apps/api/src/scripts/create-user.ts`:
```ts
import 'reflect-metadata';
import { parseArgs } from 'node:util';
import { apiEnvSchema, loadDotEnv, parseEnv } from '@dropship/config';
import { createDatabase } from '@dropship/database';
import { createUserWithRole } from '../auth/create-user';
import { ROLES, type Role } from '../auth/roles';

/**
 * Usage: NEW_USER_PASSWORD=... pnpm --filter @dropship/api user:create --email a@b.c --name "A B" --role admin
 * The password comes from an environment variable so it never lands in shell history.
 */
async function main() {
  loadDotEnv();
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' } },
  });
  const password = process.env.NEW_USER_PASSWORD;
  if (!values.email || !values.name || !values.role) {
    throw new Error('Required: --email, --name, --role');
  }
  if (!ROLES.includes(values.role as Role)) {
    throw new Error(`--role must be one of ${ROLES.join(', ')}`);
  }
  if (!password) throw new Error('Set NEW_USER_PASSWORD in the environment');

  const env = parseEnv(apiEnvSchema);
  const handle = createDatabase(env.DATABASE_URL, { maxConnections: 1 });
  try {
    const result = await createUserWithRole(
      { db: handle.db, env },
      { email: values.email, name: values.name, role: values.role as Role, password },
    );
    console.log(result.created ? `Created user ${result.userId}` : `Updated role of user ${result.userId}`);
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 10: Run all API tests**

Run: `pnpm --filter @dropship/api test`
Expected: all PASS (health, guard, auth).

- [ ] **Step 11: Cross-check the auth schema against Better Auth's generator**

Better Auth's expected columns can change between versions. From `apps/api`:
```bash
pnpm dlx @better-auth/cli@latest generate --config src/auth/auth.ts --output ../../tmp-auth-schema.ts -y
```
(In Better Auth ≥ 1.7 the CLI may instead be `pnpm dlx auth@latest generate ...`.) Compare its tables and columns with `packages/database/src/schema/auth.ts`. Add any missing column to our schema (camelCase property, snake_case column), run `pnpm db:generate`, rerun `pnpm test`, then delete `tmp-auth-schema.ts`.

- [ ] **Step 12: Commit**

```bash
git add apps/api packages/database pnpm-lock.yaml
git commit -m "feat(api): add Better Auth with roles, 2FA enforcement and user creation script"
```

---

### Task 10: Operations status endpoint and OpenAPI export

**Files:**
- Create: `apps/api/src/ops/ops.dto.ts`, `src/ops/ops.service.ts`, `src/ops/ops.controller.ts`, `src/ops/ops.module.ts`
- Create: `apps/api/src/scripts/export-openapi.ts`
- Modify: `apps/api/src/app.module.ts`
- Generated: `apps/api/openapi.json`
- Test: `apps/api/test/ops.e2e.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/test/ops.e2e.test.ts`:
```ts
import 'reflect-metadata';
import type { ApiEnv } from '@dropship/config';
import { type Database, recordHeartbeat } from '@dropship/database';
import { truncateAll } from '@dropship/database/testing';
import { DATABASE } from '@dropship/nest-common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.factory';
import { signInAs } from './auth-helpers';
import { testApiEnv } from './test-env';

describe('GET /api/ops/status', () => {
  let app: NestFastifyApplication;
  let env: ApiEnv;
  let db: Database;

  beforeAll(async () => {
    env = testApiEnv();
    app = await createApp(env);
    db = app.get(DATABASE);
  });
  beforeEach(() => truncateAll(db));
  afterAll(async () => {
    await app.close();
  });

  it('returns queue counts and worker heartbeats with staleness for operators', async () => {
    await recordHeartbeat(db, { workerGroup: 'system', instanceId: 'fresh', startedAt: new Date() });
    await recordHeartbeat(db, {
      workerGroup: 'system',
      instanceId: 'old',
      startedAt: new Date('2026-01-01T00:00:00Z'),
      seenAt: new Date('2026-01-01T00:00:00Z'),
    });
    const cookie = await signInAs(app, env, 'operator');

    const res = await app.inject({ method: 'GET', url: '/api/ops/status', headers: { cookie } });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.queues).toContainEqual(
      expect.objectContaining({ name: 'system', waiting: expect.any(Number), failed: expect.any(Number) }),
    );
    const staleByInstance = Object.fromEntries(
      body.workers.map((w: { instanceId: string; stale: boolean }) => [w.instanceId, w.stale]),
    );
    expect(staleByInstance).toEqual({ fresh: false, old: true });
  });

  it('is forbidden for viewers', async () => {
    const cookie = await signInAs(app, env, 'viewer');
    const res = await app.inject({ method: 'GET', url: '/api/ops/status', headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @dropship/api test -- test/ops.e2e.test.ts`
Expected: FAIL — 404 for `/api/ops/status` in both tests.

- [ ] **Step 3: Implement**

`apps/api/src/ops/ops.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';

export class QueueStatusDto {
  @ApiProperty() name: string;
  @ApiProperty() waiting: number;
  @ApiProperty() active: number;
  @ApiProperty() delayed: number;
  @ApiProperty() failed: number;
  @ApiProperty() completed: number;
}

export class WorkerStatusDto {
  @ApiProperty() workerGroup: string;
  @ApiProperty() instanceId: string;
  @ApiProperty({ format: 'date-time' }) lastSeenAt: string;
  @ApiProperty() stale: boolean;
}

export class OpsStatusDto {
  @ApiProperty({ type: [QueueStatusDto] }) queues: QueueStatusDto[];
  @ApiProperty({ type: [WorkerStatusDto] }) workers: WorkerStatusDto[];
}
```

`apps/api/src/ops/ops.service.ts`:
```ts
import type { ApiEnv } from '@dropship/config';
import { type Database, listHeartbeats } from '@dropship/database';
import { DATABASE } from '@dropship/nest-common';
import {
  BULL_PREFIX,
  QUEUE_NAMES,
  type QueueName,
  redisOptionsFromUrl,
  WORKER_HEARTBEAT_INTERVAL_MS,
} from '@dropship/queue';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { API_ENV } from '../config/api-config.module';
import type { OpsStatusDto } from './ops.dto';

const STALE_AFTER_MS = WORKER_HEARTBEAT_INTERVAL_MS * 3;

@Injectable()
export class OpsService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  /** Queues are opened on first use so the API starts even when Redis is briefly unavailable. */
  private queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, {
        connection: redisOptionsFromUrl(this.env.REDIS_URL),
        prefix: BULL_PREFIX,
      });
      this.queues.set(name, queue);
    }
    return queue;
  }

  async status(now: Date = new Date()): Promise<OpsStatusDto> {
    const queues = await Promise.all(
      Object.values(QUEUE_NAMES).map(async (name) => {
        const counts = await this.queue(name).getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
          'completed',
        );
        return {
          name,
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0,
        };
      }),
    );
    const workers = (await listHeartbeats(this.db)).map((row) => ({
      workerGroup: row.workerGroup,
      instanceId: row.instanceId,
      lastSeenAt: row.lastSeenAt.toISOString(),
      stale: now.getTime() - row.lastSeenAt.getTime() > STALE_AFTER_MS,
    }));
    return { queues, workers };
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
  }
}
```

`apps/api/src/ops/ops.controller.ts`:
```ts
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/roles.decorator';
import { OpsStatusDto } from './ops.dto';
import { OpsService } from './ops.service';

@ApiTags('ops')
@Controller('ops')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('status')
  @Roles('admin', 'operator')
  @ApiOkResponse({ type: OpsStatusDto })
  status(): Promise<OpsStatusDto> {
    return this.ops.status();
  }
}
```

`apps/api/src/ops/ops.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { OpsController } from './ops.controller';
import { OpsService } from './ops.service';

@Module({ controllers: [OpsController], providers: [OpsService] })
export class OpsModule {}
```

In `apps/api/src/app.module.ts`, add the import and register the module after `AuthModule`:
```ts
import { OpsModule } from './ops/ops.module';
```
```ts
        HealthModule,
        AuthModule,
        OpsModule,
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @dropship/api test`
Expected: all PASS.

- [ ] **Step 5: Add the OpenAPI export script**

`apps/api/src/scripts/export-openapi.ts`:
```ts
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiEnvSchema, loadDotEnv, parseEnv } from '@dropship/config';
import { createApp } from '../app.factory';
import { buildOpenApiDocument } from '../swagger';

/** Writes apps/api/openapi.json. Building the app does not need Postgres or Redis to be reachable. */
async function main() {
  loadDotEnv();
  const env = parseEnv(apiEnvSchema, { ...process.env, LOG_LEVEL: 'silent' });
  const app = await createApp(env);
  try {
    const document = buildOpenApiDocument(app);
    const target = resolve(__dirname, '../../openapi.json');
    writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
    console.log(`Wrote ${target}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

Run:
```bash
pnpm --filter @dropship/api build
pnpm --filter @dropship/api openapi:export
```
Expected: `apps/api/openapi.json` exists and contains paths `/api/me`, `/api/ops/status`, `/api/health/live`, `/api/health/ready`, and schemas `MeDto`, `OpsStatusDto`.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): add operations status endpoint and OpenAPI export"
```

---

### Task 11: Workers app — heartbeat and system queue

**Files:**
- Create: `apps/workers/package.json`, `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `vitest.config.ts`
- Create: `apps/workers/src/instrument.ts`, `src/main.ts`, `src/workers.module.ts`, `src/worker-config.module.ts`
- Create: `apps/workers/src/heartbeat/heartbeat.service.ts`, `src/heartbeat/heartbeat.module.ts`
- Create: `apps/workers/src/system/system.processor.ts`, `src/system/system.scheduler.ts`, `src/system/system.module.ts`
- Create: `apps/workers/test/global-setup.ts`, `test/test-env.ts`
- Test: `apps/workers/src/workers.module.test.ts`, `apps/workers/test/workers.e2e.test.ts`

- [ ] **Step 1: Create the app skeleton**

`apps/workers/package.json`:
```json
{
  "name": "@dropship/workers",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "dev": "nest start --watch",
    "start": "node dist/main.js",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  }
}
```

`apps/workers/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.nest.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src", "test"]
}
```

`apps/workers/tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "rootDir": "src" },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

`apps/workers/nest-cli.json`:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "tsConfigPath": "tsconfig.build.json",
    "deleteOutDir": true
  }
}
```

`apps/workers/vitest.config.ts`:
```ts
import { existsSync } from 'node:fs';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
```

```bash
pnpm --filter @dropship/workers add @nestjs/common @nestjs/core @nestjs/bullmq bullmq reflect-metadata rxjs pino @sentry/nestjs @dropship/config@workspace:* @dropship/observability@workspace:* @dropship/database@workspace:* @dropship/queue@workspace:* @dropship/nest-common@workspace:*
pnpm --filter @dropship/workers add -D @nestjs/cli @nestjs/schematics @nestjs/testing ioredis vitest unplugin-swc @swc/core typescript @types/node
```

- [ ] **Step 2: Write the failing tests**

`apps/workers/test/global-setup.ts`:
```ts
import { prepareTestDatabase } from '@dropship/database/testing';

export default async function setup() {
  await prepareTestDatabase();
}
```

`apps/workers/test/test-env.ts`:
```ts
import { parseEnv, type WorkerEnv, workerEnvSchema } from '@dropship/config';
import { assertTestDatabaseUrl } from '@dropship/database/testing';

export function testWorkerEnv(): WorkerEnv {
  return parseEnv(workerEnvSchema, {
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: assertTestDatabaseUrl(process.env.TEST_DATABASE_URL),
    REDIS_URL: process.env.TEST_REDIS_URL,
    WORKER_GROUPS: 'system',
  });
}
```

`apps/workers/src/workers.module.test.ts`:
```ts
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { resolveWorkerGroups } from './workers.module';

describe('resolveWorkerGroups', () => {
  it('accepts known groups', () => {
    expect(resolveWorkerGroups(['system'])).toEqual(['system']);
  });

  it('fails fast on unknown groups and lists the known ones', () => {
    expect(() => resolveWorkerGroups(['system', 'pricing'])).toThrow(/pricing.*Known: system/);
  });
});
```

`apps/workers/test/workers.e2e.test.ts`:
```ts
import 'reflect-metadata';
import { type Database, listHeartbeats, recordHeartbeat } from '@dropship/database';
import { truncateAll } from '@dropship/database/testing';
import { DATABASE } from '@dropship/nest-common';
import { QUEUE_NAMES, redisOptionsFromUrl, SYSTEM_JOBS } from '@dropship/queue';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemProcessor } from '../src/system/system.processor';
import { WorkersModule } from '../src/workers.module';
import { testWorkerEnv } from './test-env';

describe('workers app', () => {
  let app: TestingModule;
  let db: Database;

  beforeEach(async () => {
    const env = testWorkerEnv();
    const redis = new Redis(redisOptionsFromUrl(env.REDIS_URL));
    await redis.flushdb();
    await redis.quit();
    app = await Test.createTestingModule({ imports: [WorkersModule.forRoot(env)] }).compile();
    db = app.get(DATABASE);
    await truncateAll(db);
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  it('records a heartbeat for each worker group on startup', async () => {
    const rows = await listHeartbeats(db);
    expect(rows.map((r) => r.workerGroup)).toEqual(['system']);
  });

  it('registers the prune-heartbeats job scheduler', async () => {
    const queue = app.get<Queue>(getQueueToken(QUEUE_NAMES.system));
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((s) => s.key)).toContain(SYSTEM_JOBS.pruneHeartbeats);
  });

  it('prune-heartbeats deletes heartbeats older than the retention period', async () => {
    await recordHeartbeat(db, {
      workerGroup: 'system',
      instanceId: 'ancient',
      startedAt: new Date('2020-01-01T00:00:00Z'),
      seenAt: new Date('2020-01-01T00:00:00Z'),
    });
    const processor = app.get(SystemProcessor);
    const result = await processor.process({
      id: '1',
      name: SYSTEM_JOBS.pruneHeartbeats,
      data: {},
    } as Job);
    expect(result).toEqual({ deleted: 1 });
    const instanceIds = (await listHeartbeats(db)).map((r) => r.instanceId);
    expect(instanceIds).not.toContain('ancient');
  });

  it('rejects unknown system jobs', async () => {
    const processor = app.get(SystemProcessor);
    await expect(processor.process({ id: '2', name: 'nope', data: {} } as Job)).rejects.toThrow(
      /Unknown system job/,
    );
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @dropship/workers test`
Expected: FAIL — cannot find `./workers.module`.

- [ ] **Step 4: Implement**

`apps/workers/src/worker-config.module.ts`:
```ts
import { hostname } from 'node:os';
import type { WorkerEnv } from '@dropship/config';
import { createLoggerOptions } from '@dropship/observability';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import pino, { type Logger } from 'pino';

export const WORKER_ENV = Symbol('WORKER_ENV');
export const WORKER_IDENTITY = Symbol('WORKER_IDENTITY');
export const WORKER_LOGGER = Symbol('WORKER_LOGGER');

export interface WorkerIdentity {
  instanceId: string;
  startedAt: Date;
  groups: string[];
}

export type { Logger };

@Global()
@Module({})
export class WorkerConfigModule {
  static forRoot(env: WorkerEnv, groups: string[]): DynamicModule {
    const identity: WorkerIdentity = {
      instanceId: `${process.env.RAILWAY_REPLICA_ID ?? hostname()}-${process.pid}`,
      startedAt: new Date(),
      groups,
    };
    const logger = pino(
      createLoggerOptions({ service: 'workers', level: env.LOG_LEVEL, appEnv: env.APP_ENV }),
    );
    return {
      module: WorkerConfigModule,
      providers: [
        { provide: WORKER_ENV, useValue: env },
        { provide: WORKER_IDENTITY, useValue: identity },
        { provide: WORKER_LOGGER, useValue: logger },
      ],
      exports: [WORKER_ENV, WORKER_IDENTITY, WORKER_LOGGER],
    };
  }
}
```

`apps/workers/src/heartbeat/heartbeat.service.ts`:
```ts
import { type Database, recordHeartbeat } from '@dropship/database';
import { DATABASE } from '@dropship/nest-common';
import { WORKER_HEARTBEAT_INTERVAL_MS } from '@dropship/queue';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  type Logger,
  WORKER_IDENTITY,
  WORKER_LOGGER,
  type WorkerIdentity,
} from '../worker-config.module';

/** Each process writes its own heartbeat so the dashboard shows every running instance. */
@Injectable()
export class HeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WORKER_IDENTITY) private readonly identity: WorkerIdentity,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.beat();
    this.timer = setInterval(() => {
      this.beat().catch((err) => this.logger.error({ err }, 'heartbeat failed'));
    }, WORKER_HEARTBEAT_INTERVAL_MS);
    this.timer.unref();
  }

  async beat(): Promise<void> {
    await Promise.all(
      this.identity.groups.map((workerGroup) =>
        recordHeartbeat(this.db, {
          workerGroup,
          instanceId: this.identity.instanceId,
          startedAt: this.identity.startedAt,
        }),
      ),
    );
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
```

`apps/workers/src/heartbeat/heartbeat.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { HeartbeatService } from './heartbeat.service';

@Module({ providers: [HeartbeatService] })
export class HeartbeatModule {}
```

`apps/workers/src/system/system.processor.ts`:
```ts
import { type Database, pruneHeartbeats } from '@dropship/database';
import { DATABASE } from '@dropship/nest-common';
import { QUEUE_NAMES, SYSTEM_JOBS } from '@dropship/queue';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { type Job, UnrecoverableError } from 'bullmq';
import { type Logger, WORKER_LOGGER } from '../worker-config.module';

export const HEARTBEAT_RETENTION_MS = 24 * 60 * 60 * 1000;

@Processor(QUEUE_NAMES.system, { concurrency: 1 })
export class SystemProcessor extends WorkerHost {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(WORKER_LOGGER) private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job): Promise<{ deleted: number }> {
    const log = this.logger.child({
      queue: QUEUE_NAMES.system,
      jobId: job.id,
      jobName: job.name,
      correlationId: (job.data as { correlationId?: string } | undefined)?.correlationId ?? job.id,
    });
    switch (job.name) {
      case SYSTEM_JOBS.pruneHeartbeats: {
        const cutoff = new Date(Date.now() - HEARTBEAT_RETENTION_MS);
        const deleted = await pruneHeartbeats(this.db, cutoff);
        log.info({ deleted }, 'pruned worker heartbeats');
        return { deleted };
      }
      default:
        // UnrecoverableError tells BullMQ not to retry.
        throw new UnrecoverableError(`Unknown system job: ${job.name}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error({ err: error, jobId: job?.id, jobName: job?.name }, 'system job failed');
    Sentry.captureException(error, { tags: { queue: QUEUE_NAMES.system, job: job?.name } });
  }
}
```

`apps/workers/src/system/system.scheduler.ts`:
```ts
import { QUEUE_NAMES, SYSTEM_JOBS } from '@dropship/queue';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';

/** Upserting is idempotent, so every instance can safely register the same schedule on boot. */
@Injectable()
export class SystemScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE_NAMES.system) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SYSTEM_JOBS.pruneHeartbeats,
      { every: 60 * 60 * 1000 },
      {
        name: SYSTEM_JOBS.pruneHeartbeats,
        data: {},
        opts: { removeOnComplete: 100, removeOnFail: 500 },
      },
    );
  }
}
```

`apps/workers/src/system/system.module.ts`:
```ts
import { QUEUE_NAMES } from '@dropship/queue';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SystemProcessor } from './system.processor';
import { SystemScheduler } from './system.scheduler';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.system })],
  providers: [SystemProcessor, SystemScheduler],
})
export class SystemModule {}
```

`apps/workers/src/workers.module.ts`:
```ts
import type { WorkerEnv } from '@dropship/config';
import { DatabaseModule } from '@dropship/nest-common';
import { BULL_PREFIX, redisOptionsFromUrl } from '@dropship/queue';
import { BullModule } from '@nestjs/bullmq';
import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { SentryModule } from '@sentry/nestjs/setup';
import { HeartbeatModule } from './heartbeat/heartbeat.module';
import { SystemModule } from './system/system.module';
import { WorkerConfigModule } from './worker-config.module';

/** One entry per worker group. Railway services choose groups with WORKER_GROUPS. */
export const WORKER_GROUP_MODULES = {
  system: SystemModule,
} satisfies Record<string, Type<unknown>>;

export type WorkerGroup = keyof typeof WORKER_GROUP_MODULES;

export function resolveWorkerGroups(names: string[]): WorkerGroup[] {
  const known = Object.keys(WORKER_GROUP_MODULES);
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new Error(`Unknown worker group(s): ${unknown.join(', ')}. Known: ${known.join(', ')}`);
  }
  return names as WorkerGroup[];
}

@Module({})
export class WorkersModule {
  static forRoot(env: WorkerEnv): DynamicModule {
    const groups = resolveWorkerGroups(env.WORKER_GROUPS);
    return {
      module: WorkersModule,
      imports: [
        SentryModule.forRoot(),
        WorkerConfigModule.forRoot(env, groups),
        DatabaseModule.forRoot(env.DATABASE_URL),
        BullModule.forRoot({ connection: redisOptionsFromUrl(env.REDIS_URL), prefix: BULL_PREFIX }),
        HeartbeatModule,
        ...groups.map((group) => WORKER_GROUP_MODULES[group]),
      ],
    };
  }
}
```

`apps/workers/src/instrument.ts`:
```ts
import { loadDotEnv } from '@dropship/config';
import * as Sentry from '@sentry/nestjs';

loadDotEnv();

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.APP_ENV ?? 'development',
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
```

`apps/workers/src/main.ts`:
```ts
import './instrument';
import 'reflect-metadata';
import { parseEnv, workerEnvSchema } from '@dropship/config';
import { NestFactory } from '@nestjs/core';
import { WorkersModule } from './workers.module';

async function bootstrap() {
  const env = parseEnv(workerEnvSchema);
  const app = await NestFactory.createApplicationContext(WorkersModule.forRoot(env));
  // SIGTERM from Railway closes BullMQ workers (finishing active jobs) and the DB pool.
  app.enableShutdownHooks();
  await app.init();
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @dropship/workers test`
Expected: all PASS.

- [ ] **Step 6: Smoke-test**

```bash
pnpm build
pnpm --filter @dropship/workers start
```
Expected: the process starts and keeps running. In another terminal create a local admin (used in Task 12):
```bash
NEW_USER_PASSWORD='local-dev-password-123' pnpm --filter @dropship/api user:create --email dev@local.test --name Dev --role admin
```
PowerShell: run `$env:NEW_USER_PASSWORD='local-dev-password-123'` first, then the `pnpm` command without the prefix.
Expected: `Created user <id>`. Stop the worker with Ctrl+C and confirm it exits within a few seconds.

- [ ] **Step 7: Commit**

```bash
git add apps/workers pnpm-lock.yaml
git commit -m "feat(workers): add worker process with heartbeats and system queue"
```

---

### Task 12: Web SPA — login, 2FA, operations dashboard

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `index.html`
- Create: `apps/web/src/main.tsx`, `src/styles.css`
- Create: `apps/web/src/lib/auth-client.ts`, `src/lib/api.ts`, `src/lib/redirect.ts`
- Create: `apps/web/src/routes/__root.tsx`, `login.tsx`, `two-factor.tsx`, `_authed.tsx`, `_authed/index.tsx`, `_authed/setup-2fa.tsx`
- Generated: `apps/web/src/api/schema.d.ts`, `apps/web/src/routeTree.gen.ts`, `apps/web/components.json`, `apps/web/src/components/ui/*`, `apps/web/src/lib/utils.ts`
- Test: `apps/web/src/lib/redirect.test.ts`

- [ ] **Step 1: Create the app skeleton**

`apps/web/package.json`:
```json
{
  "name": "@dropship/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build && tsc --noEmit",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "api:types": "openapi-typescript ../api/openapi.json -o src/api/schema.d.ts"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "paths": { "@/*": ["./src/*"] },
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts", "vitest.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The dev and preview servers proxy /api to the API so the browser sees one origin,
// exactly like Caddy in production. changeOrigin stays false so Better Auth sees the browser's Host.
const apiProxy = { '/api': { target: 'http://localhost:3000', changeOrigin: false } };

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 4173, proxy: apiProxy },
});
```

`apps/web/vitest.config.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/**/*.test.ts'] },
});
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dropship Platform</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/styles.css`:
```css
@import "tailwindcss";
```

```bash
pnpm --filter @dropship/web add react react-dom @tanstack/react-router @tanstack/react-query better-auth openapi-fetch qrcode.react
pnpm --filter @dropship/web add -D vite @vitejs/plugin-react @tanstack/router-plugin tailwindcss @tailwindcss/vite openapi-typescript typescript @types/react @types/react-dom vitest
```

- [ ] **Step 2: Initialise shadcn/ui and generate API types**

```bash
cd apps/web
pnpm dlx shadcn@latest init --defaults --yes
pnpm dlx shadcn@latest add button input label card table alert --yes
pnpm api:types
cd ../..
```
Expected: `components.json`, `src/lib/utils.ts`, `src/components/ui/{button,input,label,card,table,alert}.tsx` exist; `src/styles.css` now contains shadcn theme variables after the Tailwind import; `src/api/schema.d.ts` exports `paths` including `"/api/ops/status"`. If `init` still asks questions, accept the defaults and choose `src/styles.css` as the CSS file.

- [ ] **Step 3: Write the failing redirect test**

`apps/web/src/lib/redirect.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { safeRedirect } from './redirect';

describe('safeRedirect', () => {
  it('keeps same-site paths', () => {
    expect(safeRedirect('/ops?tab=queues')).toBe('/ops?tab=queues');
  });

  it.each([
    ['https://evil.example'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['javascript:alert(1)'],
    [''],
    [undefined],
    [42],
  ])('falls back to / for %s', (input) => {
    expect(safeRedirect(input)).toBe('/');
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @dropship/web test`
Expected: FAIL — cannot find `./redirect`.

- [ ] **Step 5: Implement the libraries**

`apps/web/src/lib/redirect.ts`:
```ts
/** Only allows in-app paths, so a crafted ?redirect= cannot send users to another site. */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}
```

`apps/web/src/lib/auth-client.ts`:
```ts
import { adminClient, twoFactorClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
  plugins: [adminClient(), twoFactorClient()],
});
```

`apps/web/src/lib/api.ts`:
```ts
import createClient from 'openapi-fetch';
import type { components, paths } from '@/api/schema';

export const api = createClient<paths>({ baseUrl: window.location.origin, credentials: 'include' });

export type Me = components['schemas']['MeDto'];
export type OpsStatus = components['schemas']['OpsStatusDto'];

export type MeResult =
  | { kind: 'ok'; user: Me }
  | { kind: 'unauthenticated' }
  | { kind: 'two-factor-setup-required' };

export async function fetchMe(): Promise<MeResult> {
  const { data, error, response } = await api.GET('/api/me');
  if (data) return { kind: 'ok', user: data };
  if (response.status === 401) return { kind: 'unauthenticated' };
  const code = (error as { code?: string } | undefined)?.code;
  if (response.status === 403 && code === 'TWO_FACTOR_SETUP_REQUIRED') {
    return { kind: 'two-factor-setup-required' };
  }
  throw new Error(`Unexpected /api/me response: ${response.status}`);
}

export class ForbiddenError extends Error {}

export async function fetchOpsStatus(): Promise<OpsStatus> {
  const { data, response } = await api.GET('/api/ops/status');
  if (data) return data;
  if (response.status === 403) throw new ForbiddenError('Forbidden');
  throw new Error(`Unexpected /api/ops/status response: ${response.status}`);
}
```

- [ ] **Step 6: Run the test**

Run: `pnpm --filter @dropship/web test`
Expected: PASS.

- [ ] **Step 7: Implement the app shell and routes**

`apps/web/src/main.tsx`:
```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { routeTree } from './routeTree.gen';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

const router = createRouter({ routeTree, context: { queryClient }, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
```

`apps/web/src/routes/__root.tsx`:
```tsx
import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <div className="min-h-screen bg-background text-foreground">
      <Outlet />
    </div>
  ),
});
```

`apps/web/src/routes/login.tsx`:
```tsx
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { safeRedirect } from '@/lib/redirect';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>) => ({ redirect: safeRedirect(search.redirect) }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { data, error: signInError } = await authClient.signIn.email({
      email: String(form.get('email')),
      password: String(form.get('password')),
    });
    setPending(false);
    if (signInError) {
      setError(signInError.message ?? 'Sign-in failed');
      return;
    }
    if (data && 'twoFactorRedirect' in data && data.twoFactorRedirect) {
      await router.navigate({ to: '/two-factor', search: { redirect } });
      return;
    }
    router.history.push(redirect);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="username" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

`apps/web/src/routes/two-factor.tsx`:
```tsx
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { safeRedirect } from '@/lib/redirect';

export const Route = createFileRoute('/two-factor')({
  validateSearch: (search: Record<string, unknown>) => ({ redirect: safeRedirect(search.redirect) }),
  component: TwoFactorPage,
});

function TwoFactorPage() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code')).trim();
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({ code });
    if (verifyError) {
      setError(verifyError.message ?? 'Invalid code');
      return;
    }
    router.history.push(redirect);
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Two-factor verification</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Authenticator code</Label>
              <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full">
              Verify
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

`apps/web/src/routes/_authed.tsx`:
```tsx
import { createFileRoute, Outlet, redirect, useRouter } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { fetchMe } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/_authed')({
  beforeLoad: async ({ location }) => {
    const me = await fetchMe();
    if (me.kind === 'unauthenticated') {
      throw redirect({ to: '/login', search: { redirect: location.href } });
    }
    if (me.kind === 'two-factor-setup-required' && location.pathname !== '/setup-2fa') {
      throw redirect({ to: '/setup-2fa' });
    }
    return { me: me.kind === 'ok' ? me.user : null };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { me } = Route.useRouteContext();
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    await router.navigate({ to: '/login', search: { redirect: '/' } });
  }

  return (
    <div>
      <header className="flex items-center justify-between border-b px-6 py-3">
        <span className="font-semibold">Dropship Platform</span>
        <div className="flex items-center gap-4 text-sm">
          {me && (
            <span>
              {me.email} · {me.role}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

`apps/web/src/routes/_authed/setup-2fa.tsx`:
```tsx
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { QRCodeSVG } from 'qrcode.react';
import { type FormEvent, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

export const Route = createFileRoute('/_authed/setup-2fa')({ component: SetupTwoFactorPage });

function SetupTwoFactorPage() {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<{ totpURI: string; backupCodes: string[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  async function onEnable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const password = String(new FormData(event.currentTarget).get('password'));
    const { data, error: enableError } = await authClient.twoFactor.enable({ password });
    if (enableError || !data || !('totpURI' in data)) {
      setError(enableError?.message ?? 'Could not start 2FA setup');
      return;
    }
    setEnrollment({ totpURI: data.totpURI, backupCodes: data.backupCodes });
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const code = String(new FormData(event.currentTarget).get('code')).trim();
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({ code });
    if (verifyError) {
      setError(verifyError.message ?? 'Invalid code');
      return;
    }
    await router.invalidate();
    await router.navigate({ to: '/' });
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>Set up two-factor authentication</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!enrollment ? (
          <form onSubmit={onEnable} className="space-y-4">
            <p className="text-sm">
              Two-factor authentication is required. Confirm your password to start.
            </p>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit">Continue</Button>
          </form>
        ) : (
          <form onSubmit={onVerify} className="space-y-4">
            <p className="text-sm">
              Scan this code with your authenticator app, then enter the 6-digit code.
            </p>
            <div className="flex justify-center rounded bg-white p-4">
              <QRCodeSVG value={enrollment.totpURI} size={192} />
            </div>
            <div>
              <p className="text-sm font-medium">Backup codes — store them somewhere safe:</p>
              <pre className="mt-2 rounded bg-muted p-3 text-sm">
                {enrollment.backupCodes.join('\n')}
              </pre>
            </div>
            <div className="space-y-2">
              <Label htmlFor="code">Authenticator code</Label>
              <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required />
            </div>
            <Button type="submit">Verify and finish</Button>
          </form>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
```

`apps/web/src/routes/_authed/index.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ForbiddenError, fetchOpsStatus } from '@/lib/api';

export const Route = createFileRoute('/_authed/')({ component: OpsDashboard });

function OpsDashboard() {
  const status = useQuery({
    queryKey: ['ops-status'],
    queryFn: fetchOpsStatus,
    refetchInterval: 15_000,
  });

  if (status.error instanceof ForbiddenError) {
    return (
      <Alert>
        <AlertDescription>You do not have access to operations status.</AlertDescription>
      </Alert>
    );
  }
  if (status.error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Could not load operations status.</AlertDescription>
      </Alert>
    );
  }
  if (!status.data) return <p>Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Operations status</h1>
      <Card>
        <CardHeader>
          <CardTitle>Queues</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Queue</TableHead>
                <TableHead>Waiting</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Delayed</TableHead>
                <TableHead>Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.data.queues.map((queue) => (
                <TableRow key={queue.name}>
                  <TableCell>{queue.name}</TableCell>
                  <TableCell>{queue.waiting}</TableCell>
                  <TableCell>{queue.active}</TableCell>
                  <TableCell>{queue.delayed}</TableCell>
                  <TableCell>{queue.failed}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Workers</CardTitle>
        </CardHeader>
        <CardContent>
          {status.data.workers.length === 0 ? (
            <p className="text-sm">No worker has reported a heartbeat yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Group</TableHead>
                  <TableHead>Instance</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.data.workers.map((worker) => (
                  <TableRow key={`${worker.workerGroup}:${worker.instanceId}`}>
                    <TableCell>{worker.workerGroup}</TableCell>
                    <TableCell>{worker.instanceId}</TableCell>
                    <TableCell>{new Date(worker.lastSeenAt).toLocaleString()}</TableCell>
                    <TableCell>{worker.stale ? 'Stale' : 'Healthy'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 8: Build and verify manually**

```bash
pnpm --filter @dropship/web build
```
Expected: `src/routeTree.gen.ts` is generated, `dist/` is produced, and `tsc --noEmit` passes. Commit `routeTree.gen.ts` (it is required for `pnpm typecheck` in CI).

Then run the full stack: `pnpm --filter @dropship/api start`, `pnpm --filter @dropship/workers start`, `pnpm --filter @dropship/web dev`. Open `http://localhost:5173`:
1. You are redirected to `/login?redirect=...`.
2. Sign in as `dev@local.test` (created in Task 11). You land on **Operations status** with a `system` queue row and one healthy `system` worker.
3. Set `REQUIRE_2FA=true` in `.env`, restart the API, reload: you are sent to **Set up two-factor authentication**. Complete it with an authenticator app; you return to the dashboard. Sign out and sign in again: you are asked for the code. Set `REQUIRE_2FA=false` again afterwards if you prefer.

- [ ] **Step 9: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): add SPA with login, 2FA setup and operations dashboard"
```

---

### Task 13: Docker images and Caddy

**Files:**
- Create: `apps/api/Dockerfile`, `apps/workers/Dockerfile`, `apps/web/Dockerfile`, `apps/web/Caddyfile`

- [ ] **Step 1: Write the API image**

`apps/api/Dockerfile`:
```dockerfile
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@^2 prune @dropship/api --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@dropship/api

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app .
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
```

- [ ] **Step 2: Write the workers image**

`apps/workers/Dockerfile`:
```dockerfile
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@^2 prune @dropship/workers --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@dropship/workers

FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app .
USER node
CMD ["node", "apps/workers/dist/main.js"]
```

The runtime images include dev dependencies. That is acceptable for Phase 1; slimming them (`pnpm deploy --prod`) is a Phase 8 hardening task.

- [ ] **Step 3: Write the web image and Caddyfile**

`apps/web/Caddyfile`:
```text
{
	admin off
}

:{$PORT:8080} {
	encode zstd gzip

	handle /api/* {
		reverse_proxy {$API_UPSTREAM}
	}

	handle {
		root * /srv
		header /assets/* Cache-Control "public, max-age=31536000, immutable"
		try_files {path} /index.html
		file_server
	}
}
```

`apps/web/Dockerfile`:
```dockerfile
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS pruner
COPY . .
RUN pnpm dlx turbo@^2 prune @dropship/web --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@dropship/web

FROM caddy:2-alpine AS runner
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/apps/web/dist /srv
```

- [ ] **Step 4: Build all images and run the web image against the local API**

```bash
docker build -f apps/api/Dockerfile -t dropship-api .
docker build -f apps/workers/Dockerfile -t dropship-workers .
docker build -f apps/web/Dockerfile -t dropship-web .
docker run --rm -p 8080:8080 -e API_UPSTREAM=host.docker.internal:3000 dropship-web
```
Expected: all three builds succeed. With the API running locally on port 3000, `http://localhost:8080/api/health/live` returns `{"status":"ok"}` and `http://localhost:8080/some/deep/link` serves the SPA (not a 404). Stop the container with Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add apps/api/Dockerfile apps/workers/Dockerfile apps/web/Dockerfile apps/web/Caddyfile
git commit -m "chore: add Docker images for api, workers and web (Caddy)"
```

---

### Task 14: CI pipeline and Playwright end-to-end test

**Files:**
- Create: `e2e/package.json`, `e2e/tsconfig.json`, `e2e/playwright.config.ts`, `e2e/global-setup.ts`, `e2e/tests/login.spec.ts`
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the e2e package**

`e2e/package.json` (the script is `e2e`, not `test`, so `pnpm test` does not start servers):
```json
{
  "name": "@dropship/e2e",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "e2e": "playwright test"
  }
}
```

`e2e/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["**/*.ts"]
}
```

```bash
pnpm --filter @dropship/e2e add -D @playwright/test typescript @types/node
pnpm --filter @dropship/e2e exec playwright install chromium
```

`e2e/playwright.config.ts`:
```ts
import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

const rootEnv = new URL('../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// The preview server runs on 4173; the API must treat that as the browser origin.
process.env.BETTER_AUTH_URL = 'http://localhost:4173';
process.env.WEB_ORIGIN = 'http://localhost:4173';
process.env.REQUIRE_2FA = 'false';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @dropship/api start',
      url: 'http://localhost:3000/api/health/ready',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @dropship/web preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
```

`e2e/global-setup.ts`:
```ts
import { execFileSync } from 'node:child_process';

export const E2E_USER = { email: 'e2e-operator@test.local', password: 'e2e-operator-password-123' };

export default function globalSetup() {
  execFileSync(
    'pnpm',
    [
      '--filter',
      '@dropship/api',
      'user:create',
      '--email',
      E2E_USER.email,
      '--name',
      'E2E Operator',
      '--role',
      'operator',
    ],
    {
      stdio: 'inherit',
      env: { ...process.env, NEW_USER_PASSWORD: E2E_USER.password },
      shell: process.platform === 'win32',
    },
  );
}
```

`e2e/tests/login.spec.ts`:
```ts
import { expect, test } from '@playwright/test';
import { E2E_USER } from '../global-setup';

test('operator signs in and sees operations status', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('Email').fill(E2E_USER.email);
  await page.getByLabel('Password').fill(E2E_USER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Operations status' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'system', exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 2: Run the e2e test locally**

```bash
pnpm build
pnpm db:migrate
pnpm --filter @dropship/e2e e2e
```
Expected: 1 test PASS. If a dev API is already running on port 3000 it is reused; stop it first (it was started with a different `BETTER_AUTH_URL`).

- [ ] **Step 3: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  APP_ENV: test
  TEST_DATABASE_URL: postgres://dropship:dropship@localhost:5432/dropship_test
  TEST_REDIS_URL: redis://localhost:6379/1
  DATABASE_URL: postgres://dropship:dropship@localhost:5432/dropship_test
  REDIS_URL: redis://localhost:6379/0
  BETTER_AUTH_SECRET: ci-secret-ci-secret-ci-secret-ci-secret-00
  BETTER_AUTH_URL: http://localhost:4173
  WEB_ORIGIN: http://localhost:4173
  REQUIRE_2FA: "false"
  WORKER_GROUPS: system

jobs:
  verify:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: dropship
          POSTGRES_PASSWORD: dropship
          POSTGRES_DB: dropship_test
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U dropship"
          --health-interval 5s --health-timeout 5s --health-retries 10
      redis:
        image: redis:7.4
        ports: ["6379:6379"]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm typecheck
      - run: pnpm test
      - name: OpenAPI and client types are up to date
        run: |
          pnpm --filter @dropship/api openapi:export
          pnpm --filter @dropship/web api:types
          git diff --exit-code apps/api/openapi.json apps/web/src/api/schema.d.ts
      - name: Install Playwright browser
        run: pnpm --filter @dropship/e2e exec playwright install --with-deps chromium
      - run: pnpm db:migrate
      - run: pnpm --filter @dropship/e2e e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: e2e/playwright-report
```

The e2e step reuses `dropship_test` as `DATABASE_URL`; that is safe because CI's database is disposable.

- [ ] **Step 4: Commit and confirm CI passes**

```bash
git add e2e .github pnpm-lock.yaml
git commit -m "ci: add CI pipeline with integration and end-to-end tests"
```
Push the branch and open a PR. Expected: the `verify` job passes. If the OpenAPI drift step fails, run the two generation commands locally and commit the result.

---

### Task 15: Railway configuration, runbooks and README

**Files:**
- Create: `deployment/railway/api.json`, `deployment/railway/workers.json`, `deployment/railway/web.json`
- Create: `docs/operations/local-development.md`, `docs/operations/railway.md`, `README.md`
- Modify: `docs/plans/README.md`

- [ ] **Step 1: Write Railway config-as-code files**

`deployment/railway/api.json`:
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "apps/api/Dockerfile",
    "watchPatterns": ["apps/api/**", "packages/**", "pnpm-lock.yaml"]
  },
  "deploy": {
    "preDeployCommand": ["node packages/database/dist/migrate-cli.js"],
    "healthcheckPath": "/api/health/ready",
    "healthcheckTimeout": 60,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

`deployment/railway/workers.json`:
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "apps/workers/Dockerfile",
    "watchPatterns": ["apps/workers/**", "packages/**", "pnpm-lock.yaml"]
  },
  "deploy": {
    "restartPolicyType": "ALWAYS"
  }
}
```

`deployment/railway/web.json`:
```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": {
    "builder": "DOCKERFILE",
    "dockerfilePath": "apps/web/Dockerfile",
    "watchPatterns": ["apps/web/**", "pnpm-lock.yaml"]
  },
  "deploy": {
    "healthcheckPath": "/",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

- [ ] **Step 2: Write the Railway runbook**

`docs/operations/railway.md`:
````markdown
# Railway deployment runbook

## Services

| Service | Config file | Public? | Notes |
|---------|-------------|---------|-------|
| `web` | `deployment/railway/web.json` | Yes (custom domain) | Caddy: serves the SPA, proxies `/api/*` to `api` over private networking |
| `api` | `deployment/railway/api.json` | No | Runs migrations as a pre-deploy command |
| `workers` | `deployment/railway/workers.json` | No | `WORKER_GROUPS` selects which groups run |
| `Postgres` | Railway database | No | |
| `Redis` | Railway database (or Docker image, see below) | No | Must be `noeviction` + AOF |

Create two Railway environments: `staging` and `production`. Do every step below in both.

## First-time setup

1. Create a Railway project and connect this GitHub repository.
2. Add **PostgreSQL** and **Redis** from the Railway database templates.
3. Create services `api`, `workers`, `web` from the repository. In each service's settings, set
   **Config-as-code path** to its file in `deployment/railway/`. Keep the root directory as the repo root.
4. Set variables (Railway reference syntax shown):

   **api**
   ```text
   APP_ENV=staging            # production in the production environment
   PORT=3000
   LOG_LEVEL=info
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   BETTER_AUTH_SECRET=<random, 32+ chars, different per environment>
   BETTER_AUTH_URL=https://<web public domain>
   WEB_ORIGIN=https://<web public domain>
   REQUIRE_2FA=true
   SENTRY_DSN=<optional>
   ```

   **workers**
   ```text
   APP_ENV=staging
   LOG_LEVEL=info
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   WORKER_GROUPS=system
   SENTRY_DSN=<optional>
   ```

   **web**
   ```text
   PORT=8080
   API_UPSTREAM=${{api.RAILWAY_PRIVATE_DOMAIN}}:3000
   ```

5. Generate a public domain (or attach a custom domain) for `web` only. `api` and `workers` stay private.
6. Deploy. The `api` pre-deploy command applies migrations before the new version starts.
7. Create the first admin. With the Railway CLI linked to the project and environment:
   ```bash
   railway ssh --service api
   NEW_USER_PASSWORD='<strong password>' node apps/api/dist/scripts/create-user.js --email you@example.com --name "Your Name" --role admin
   ```
8. Sign in at the web domain and complete 2FA setup.

## Redis requirements (check before production)

BullMQ requires `maxmemory-policy noeviction`; any eviction policy can silently drop jobs. Persistence must be on.

```bash
railway connect Redis
CONFIG GET maxmemory-policy   # must be noeviction
CONFIG GET appendonly         # should be yes
```

If the Railway Redis template does not let you set these permanently, replace it with a service built from the
`redis:7.4` Docker image, start command
`redis-server --appendonly yes --maxmemory-policy noeviction --requirepass ${REDIS_PASSWORD}`,
and a volume mounted at `/data`. Update the `REDIS_URL` references to point at it.

## PostgreSQL backups

Confirm what backups and point-in-time recovery the Railway plan provides (platform plan §14 open decision).
Test a restore into staging before the production launch.

## Verifying a deployment

- `https://<web domain>/api/health/ready` returns `{"status":"ok",...}`.
- Sign in; the **Operations status** page lists the `system` queue and a healthy `system` worker.
- Railway logs for `api` and `workers` are JSON lines with `service` and `env` fields, and contain no secrets.
````

- [ ] **Step 3: Write the local development guide and README**

`docs/operations/local-development.md`:
````markdown
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
| `pnpm --filter @dropship/e2e e2e` | Playwright end-to-end tests (after `pnpm build`) |

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
````

`README.md`:
```markdown
# Dropship Platform

Amazon US → Canada/Mexico dropshipping operations platform.

- Requirements and architecture: [`docs/architecture/platform-plan.md`](docs/architecture/platform-plan.md)
- Implementation roadmap: [`docs/plans/README.md`](docs/plans/README.md)
- Local development: [`docs/operations/local-development.md`](docs/operations/local-development.md)
- Deployment: [`docs/operations/railway.md`](docs/operations/railway.md)
```

- [ ] **Step 4: Final verification**

```bash
pnpm lint && pnpm build && pnpm typecheck && pnpm test
```
Expected: everything passes.

- [ ] **Step 5: Update the roadmap and commit**

In `docs/plans/README.md`, change Plan 1's status from **Ready** to **Done**.

```bash
git add deployment docs README.md
git commit -m "docs: add Railway config, runbooks and README"
```

- [ ] **Step 6: Deploy to Railway staging**

Follow `docs/operations/railway.md` for the `staging` environment. This needs the project owner's Railway account; without access, stop here and hand over with the runbook.

**Phase 1 exit criteria** (platform plan §9): staging is deployed; sign-in with 2FA works; `/api/health/ready` is green; migrations ran via the pre-deploy command; the ops dashboard shows a healthy worker; logs are structured JSON with secrets redacted; Sentry receives errors when `SENTRY_DSN` is set; CI is green.
