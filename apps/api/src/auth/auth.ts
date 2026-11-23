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
  /** HTTP rate limiting. Defaults to on; tests and the create-user script turn it off. */
  rateLimit?: boolean;
}

export function createAuth(options: CreateAuthOptions) {
  return betterAuth({
    appName: 'Dropship Platform',
    secret: options.secret,
    baseURL: options.baseURL,
    basePath: '/api/auth',
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(options.db, { provider: 'pg', schema: authSchema }),
    advanced: {
      // Explicit so the checks never depend on env vars: Better Auth otherwise skips
      // the origin check whenever NODE_ENV=test or TEST is set.
      disableOriginCheck: false,
      disableCSRFCheck: false,
      // Caddy sits in front and overwrites X-Forwarded-For; the API is not publicly reachable.
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
    },
    // In-memory storage is per process: fine for Phase 1's single API replica.
    // Running several replicas needs shared (secondary) storage for the limits to hold.
    rateLimit: {
      enabled: options.rateLimit ?? true,
      storage: 'memory',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/two-factor/verify-totp': { window: 60, max: 5 },
      },
    },
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
