import type { ApiEnv } from '@dropship/config';
import type { Database } from '@dropship/database';
import { DATABASE } from '@dropship/nest-common';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { API_ENV } from '../config/api-config.module';
import { createAuth } from './auth';
import { AUTH } from './auth.tokens';
import { MeController } from './me.controller';
import { SessionGuard } from './session.guard';

@Module({
  controllers: [MeController],
  providers: [
    {
      provide: AUTH,
      inject: [DATABASE, API_ENV],
      useFactory: (db: Database, env: ApiEnv) =>
        createAuth({
          db,
          secret: env.BETTER_AUTH_SECRET,
          baseURL: env.BETTER_AUTH_URL,
          trustedOrigins: [env.WEB_ORIGIN],
        }),
    },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
  exports: [AUTH],
})
export class AuthModule {}
