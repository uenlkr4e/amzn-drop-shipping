import { randomUUID } from 'node:crypto';
import type { ApiEnv } from '@dropship/config';
import { createLoggerOptions } from '@dropship/observability';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';

export async function createApp(env: ApiEnv): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    logger: createLoggerOptions({ service: 'api', level: env.LOG_LEVEL, appEnv: env.APP_ENV }),
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    trustProxy: true,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(env), adapter, {
    logger: env.LOG_LEVEL === 'silent' ? false : undefined,
  });
  app.setGlobalPrefix('api');
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
