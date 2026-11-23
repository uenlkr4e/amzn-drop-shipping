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
    rateLimit: false,
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
