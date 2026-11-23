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
    await expect(guard(reader).canActivate(contextFor('open', { headers: {} }))).resolves.toBe(
      true,
    );
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

  it('rejects banned users', async () => {
    const promise = guard(
      readerReturning({ ...operator, banned: true, banExpires: null }),
    ).canActivate(contextFor('anyUser', { headers: {} }));
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    await expect(promise).rejects.toMatchObject({ response: { code: 'USER_BANNED' } });
  });

  it('rejects users whose ban has not expired yet', async () => {
    const banExpires = new Date(Date.now() + 60_000);
    const promise = guard(readerReturning({ ...operator, banned: true, banExpires })).canActivate(
      contextFor('anyUser', { headers: {} }),
    );
    await expect(promise).rejects.toMatchObject({ response: { code: 'USER_BANNED' } });
  });

  it('allows users whose ban has expired', async () => {
    const banExpires = new Date(Date.now() - 60_000);
    await expect(
      guard(readerReturning({ ...operator, banned: true, banExpires })).canActivate(
        contextFor('anyUser', { headers: {} }),
      ),
    ).resolves.toBe(true);
  });
});
