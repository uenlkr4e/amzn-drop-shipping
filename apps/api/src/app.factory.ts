import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { ApiEnv } from '@dropship/config';
import { PinoLoggerService } from '@dropship/nest-common';
import { createLoggerOptions } from '@dropship/observability';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import pino from 'pino';
import { AppModule } from './app.module';
import type { Auth } from './auth/auth';
import { AUTH } from './auth/auth.tokens';
import { registerAuthRoutes } from './auth/register-auth-routes';
import { setupSwagger } from './swagger';

const REQUEST_ID = /^[\w.:-]{1,128}$/;

/** Reuses a well-formed incoming x-request-id for correlation; otherwise generates one. */
function genReqId(req: IncomingMessage): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

export async function createApp(env: ApiEnv): Promise<NestFastifyApplication> {
  const loggerOptions = createLoggerOptions({
    service: 'api',
    level: env.LOG_LEVEL,
    appEnv: env.APP_ENV,
  });
  // Nest's and Better Auth's messages; Fastify's request logger below stays separate.
  const logger = pino(loggerOptions);
  const adapter = new FastifyAdapter({
    logger: {
      ...loggerOptions,
      // Log the path only: query strings may carry tokens. Headers are not logged at all.
      serializers: {
        req: (req: { method: string; url: string; id: string }) => ({
          method: req.method,
          url: req.url.split('?')[0],
          id: req.id,
        }),
      },
    },
    // Fastify would trust any incoming header value verbatim; genReqId validates it instead.
    requestIdHeader: false,
    genReqId,
    trustProxy: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(env, logger),
    adapter,
    {
      logger: env.LOG_LEVEL === 'silent' ? false : new PinoLoggerService(logger),
    },
  );
  app.setGlobalPrefix('api');
  registerAuthRoutes(app, app.get<Auth>(AUTH), env.BETTER_AUTH_URL);
  app.enableShutdownHooks();
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (request, reply) => {
      reply.header('x-request-id', request.id);
    });
  setupSwagger(app, env);
  await app.init();
  return app;
}
