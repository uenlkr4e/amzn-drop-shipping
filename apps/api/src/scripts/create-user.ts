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
    console.log(
      result.created ? `Created user ${result.userId}` : `Updated role of user ${result.userId}`,
    );
  } finally {
    await handle.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
