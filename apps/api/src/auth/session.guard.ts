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
