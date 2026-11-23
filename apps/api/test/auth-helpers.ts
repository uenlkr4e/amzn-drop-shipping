import { randomUUID } from 'node:crypto';
import type { ApiEnv } from '@dropship/config';
import type { Database } from '@dropship/database';
import { DATABASE } from '@dropship/nest-common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createUserWithRole } from '../src/auth/create-user';
import type { Role } from '../src/auth/roles';

export const TEST_PASSWORD = 'correct-horse-battery-staple';

/** Creates a user with the role, signs in through the real HTTP endpoint, returns a Cookie header. */
export async function signInAs(
  app: NestFastifyApplication,
  env: ApiEnv,
  role: Role,
): Promise<string> {
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
  const cookies = (Array.isArray(raw) ? raw : [raw]).filter(
    (c): c is string => typeof c === 'string',
  );
  return cookies.map((cookie) => cookie.split(';')[0]).join('; ');
}
