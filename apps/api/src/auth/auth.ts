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
