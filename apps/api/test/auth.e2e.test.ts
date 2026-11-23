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
