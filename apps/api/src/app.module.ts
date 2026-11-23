import type { ApiEnv } from '@dropship/config';
import { DatabaseModule, RedisModule } from '@dropship/nest-common';
import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { AuthModule } from './auth/auth.module';
import { ApiConfigModule } from './config/api-config.module';
import { HealthModule } from './health/health.module';

@Module({})
export class AppModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        SentryModule.forRoot(),
        ApiConfigModule.forRoot(env),
        DatabaseModule.forRoot(env.DATABASE_URL),
        RedisModule.forRoot(env.REDIS_URL),
        HealthModule,
        AuthModule,
      ],
      providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
    };
  }
}
