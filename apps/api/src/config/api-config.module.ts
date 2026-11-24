import type { ApiEnv } from '@dropship/config';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { Logger } from 'pino';

export const API_ENV = Symbol('API_ENV');
/** The API's pino logger (Nest and Better Auth messages). Fastify keeps its own request logger. */
export const API_LOGGER = Symbol('API_LOGGER');

@Global()
@Module({})
export class ApiConfigModule {
  static forRoot(env: ApiEnv, logger: Logger): DynamicModule {
    return {
      module: ApiConfigModule,
      providers: [
        { provide: API_ENV, useValue: env },
        { provide: API_LOGGER, useValue: logger },
      ],
      exports: [API_ENV, API_LOGGER],
    };
  }
}
