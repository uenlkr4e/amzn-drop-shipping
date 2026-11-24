# Railway deployment runbook

> Status: the configuration below has not been deployed yet (Phase 1 Task 15, Step 6 is pending the owner's
> Railway account). Railway's config-as-code schema cannot be validated offline, so **verify the
> `deployment/railway/*.json` keys on the first deploy** and fix any the dashboard rejects.

## Services

| Service | Config file | Public? | Notes |
|---------|-------------|---------|-------|
| `web` | `deployment/railway/web.json` | Yes (custom domain) | Caddy: serves the SPA, proxies `/api/*` to `api` over private networking |
| `api` | `deployment/railway/api.json` | **No, never** | Runs migrations as a pre-deploy command |
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
   TRUSTED_PROXIES=<optional, space-separated CIDRs; default private_ranges>
   ```

   `TRUSTED_PROXIES` lists the peers Caddy accepts `X-Forwarded-For` from (Railway's edge proxy). Caddy reads that
   header right to left (`trusted_proxies_strict`), takes the first untrusted address as the client IP and sends the
   API exactly that one address. Leave it unset unless the first-deploy check in step 9 fails.

5. Generate a public domain (or attach a custom domain) for `web` only. `api` and `workers` stay private.
6. Deploy. The `api` pre-deploy command applies migrations before the new version starts.
7. Create the first admin. With the Railway CLI linked to the project and environment:
   ```bash
   railway ssh --service api
   NEW_USER_PASSWORD='<strong password>' node apps/api/dist/scripts/create-user.js --email you@example.com --name "Your Name" --role admin
   ```
8. Sign in at the web domain and complete 2FA setup.
9. **Check the client IP the API sees** (do this on the first deploy of each environment). After signing in, run
   against the environment's Postgres (`railway connect Postgres`):
   ```sql
   SELECT metadata->>'ipAddress' AS ip, occurred_at FROM audit_logs
   WHERE action = 'auth.session_created' ORDER BY occurred_at DESC LIMIT 1;
   ```
   `ip` must be your own public IP (compare with https://ifconfig.me). If it is a Railway edge address instead, Caddy
   does not trust the edge proxy: every user then shares one rate-limit bucket. Set `TRUSTED_PROXIES` on `web` to
   Railway's edge range (the address you saw belongs to it; use Railway's published range), redeploy `web`, and
   repeat this check.

## User management is CLI-only

Better Auth's `/api/auth/admin/*` HTTP routes are blocked (they return 404). Create users and change roles only with
the `create-user` script (step 7 above); each run is audited. Running it for an **existing email only updates the
role**. It does not change the password or the name.

## Security and scaling constraints

- **Run exactly one `api` replica** until shared rate-limit storage is added. Sign-in and TOTP verification are
  limited to 5 per minute per IP by Better Auth's **in-memory** limiter (active whenever `APP_ENV` is not `test`),
  so multiple replicas would each keep separate counters.
- The limiter keys on `X-Forwarded-For`, which Caddy (`web`) overwrites with a single client IP. That IP is only the
  real user's if Caddy trusts Railway's edge proxy (`TRUSTED_PROXIES`, verified by first-time setup step 9); otherwise
  the limit is per edge address, shared by all users. The `api` service must stay private: **never give `api` a
  public domain**, or clients could spoof that header and bypass the limit.
- Origin/CSRF checks are always on; `WEB_ORIGIN` and `BETTER_AUTH_URL` must match the public web domain exactly.
- `REQUIRE_2FA=true` is enforced when `APP_ENV=production`: the API refuses to start otherwise.

## Worker behaviour

- Workers exit with code 1 if they cannot finish booting within 60 seconds (for example, Redis unreachable). Rely on
  the Railway restart policy (`ALWAYS`) to retry.
- Heartbeats stop while Redis is unreachable, so the Operations status page shows the worker as **Stale**.

## Docker images

The api and workers images are about 1 GB each (dev dependencies are included; slimming is deferred to Phase 8).
The web image is about 90 MB (Caddy).

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
