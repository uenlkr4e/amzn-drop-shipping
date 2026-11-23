import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { Auth } from './auth';

const ADMIN_PATH = /^\/api\/auth\/admin(\/|$)/;

/**
 * User management is CLI-only (audited, see create-user.ts), so the admin plugin's HTTP
 * endpoints are never served. The path is decoded, slash-collapsed and lowercased first so
 * encoded or oddly-cased variants cannot slip past the check.
 */
function isAdminPath(pathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return true;
  }
  return ADMIN_PATH.test(decoded.replace(/\/{2,}/g, '/').toLowerCase());
}

/**
 * Mounts Better Auth at /api/auth/* directly on Fastify, outside Nest's guards.
 * `baseUrl` is the configured BETTER_AUTH_URL: request URLs are built from it rather than
 * from the client-controlled Host / X-Forwarded-Host headers.
 */
export function registerAuthRoutes(app: NestFastifyApplication, auth: Auth, baseUrl: string): void {
  const origin = new URL(baseUrl).origin;
  const fastify = app.getHttpAdapter().getInstance();
  fastify.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const url = new URL(request.url, origin);
      if (isAdminPath(url.pathname)) {
        return reply.status(404).send({ statusCode: 404, message: 'Not Found' });
      }
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          ...(request.body ? { body: JSON.stringify(request.body) } : {}),
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header('set-cookie', cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
