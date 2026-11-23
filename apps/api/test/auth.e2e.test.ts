import { randomInt } from 'node:crypto';
import 'reflect-metadata';
import type { ApiEnv } from '@dropship/config';
import { auditLogs, type Database, user } from '@dropship/database';
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
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'EMAIL_PASSWORD_SIGN_UP_DISABLED' });
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

  it('rejects cookie-authenticated POSTs from untrusted origins', async () => {
    const cookie = await signInAs(app, env, 'operator');
    const signOut = (origin: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/sign-out',
        headers: { 'content-type': 'application/json', cookie, origin },
        payload: {},
      });
    const evil = await signOut('https://evil.example');
    expect(evil.statusCode).toBe(403);
    expect(evil.json()).toMatchObject({ code: 'INVALID_ORIGIN' });
    const trusted = await signOut(env.WEB_ORIGIN);
    expect(trusted.statusCode).toBe(200);
  });

  it('does not expose the admin plugin over HTTP', async () => {
    const cookie = await signInAs(app, env, 'admin');
    const target = await createUserWithRole(
      { db, env },
      { email: 'target@test.local', password: TEST_PASSWORD, name: 'T', role: 'viewer' },
    );
    const setRole = await app.inject({
      method: 'POST',
      url: '/api/auth/admin/set-role',
      headers: { 'content-type': 'application/json', cookie, origin: env.WEB_ORIGIN },
      payload: { userId: target.userId, role: 'admin' },
    });
    expect(setRole.statusCode).toBe(404);
    const [row] = await db.select().from(user).where(eq(user.id, target.userId));
    expect(row?.role).toBe('viewer');
    for (const url of [
      '/api/auth/admin/list-users',
      '/api/auth/admin/list-users/',
      '/api/auth//admin/list-users',
      '/api/auth/Admin/list-users',
      '/api/auth/%61dmin/list-users',
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: { cookie } });
      expect(res.statusCode, url).toBe(404);
    }
  });

  it('ignores a malformed X-Forwarded-Host when building the auth URL', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { 'x-forwarded-host': 'a b/%' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rate-limits repeated failed sign-ins when rate limiting is on', async () => {
    const limitedEnv = testApiEnv({ APP_ENV: 'staging' });
    const limited = await createApp(limitedEnv);
    try {
      const email = 'limited@test.local';
      await createUserWithRole(
        { db, env: limitedEnv },
        { email, password: TEST_PASSWORD, name: 'L', role: 'viewer' },
      );
      // A fresh client IP per run: Better Auth's in-memory limiter is shared across the process.
      const ip = `203.0.113.${randomInt(1, 255)}`;
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const res = await limited.inject({
          method: 'POST',
          url: '/api/auth/sign-in/email',
          headers: {
            'content-type': 'application/json',
            origin: limitedEnv.WEB_ORIGIN,
            'x-forwarded-for': ip,
          },
          payload: { email, password: 'wrong-password-wrong' },
        });
        statuses.push(res.statusCode);
      }
      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    } finally {
      await limited.close();
    }
  });
});
