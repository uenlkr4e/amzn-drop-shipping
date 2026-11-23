import { redisOptionsFromUrl } from '@dropship/queue';
import {
  type DynamicModule,
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS = Symbol('REDIS');

@Global()
@Module({})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** lazyConnect: the first command opens the connection, so building the app never blocks on Redis. */
  static forRoot(url: string): DynamicModule {
    return {
      module: RedisModule,
      providers: [
        {
          provide: REDIS,
          useFactory: () => new Redis({ ...redisOptionsFromUrl(url), lazyConnect: true }),
        },
      ],
      exports: [REDIS],
    };
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis.status === 'ready') {
      // quit() resolves on the server's OK; wait for the socket to actually close.
      const closed = new Promise<void>((resolve) => this.redis.once('end', () => resolve()));
      await this.redis.quit();
      await closed;
      return;
    }
    this.redis.disconnect();
  }
}
