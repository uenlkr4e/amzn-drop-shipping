import { createDatabase, type DatabaseHandle } from '@dropship/database';
import {
  type DynamicModule,
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';

export const DATABASE = Symbol('DATABASE');
export const DATABASE_HANDLE = Symbol('DATABASE_HANDLE');

@Global()
@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_HANDLE) private readonly handle: DatabaseHandle) {}

  static forRoot(
    url: string,
    options: { maxConnections?: number; onError?: (error: Error) => void } = {},
  ): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        { provide: DATABASE_HANDLE, useFactory: () => createDatabase(url, options) },
        {
          provide: DATABASE,
          useFactory: (handle: DatabaseHandle) => handle.db,
          inject: [DATABASE_HANDLE],
        },
      ],
      exports: [DATABASE, DATABASE_HANDLE],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
