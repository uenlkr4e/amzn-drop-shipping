import type { ApiEnv } from '@dropship/config';
import { type DynamicModule, Global, Module } from '@nestjs/common';

export const API_ENV = Symbol('API_ENV');

@Global()
@Module({})
export class ApiConfigModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: ApiConfigModule,
      providers: [{ provide: API_ENV, useValue: env }],
      exports: [API_ENV],
    };
  }
}
