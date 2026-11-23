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
    if (this.redis.status !== 'ready') {
      this.redis.disconnect();
      return;
    }
    let timer: NodeJS.Timeout | undefined;
    let onEnd: (() => void) | undefined;
    try {
      // quit() resolves on the server's OK; wait for the socket to actually close.
      const closed = new Promise<void>((resolve) => {
        onEnd = resolve;
        this.redis.once('end', onEnd);
      });
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5000);
      });
      await Promise.race([this.redis.quit().then(() => closed), timeout]);
    } catch {
      // shutdown must never throw; disconnect below forces the close
    } finally {
      clearTimeout(timer);
      if (onEnd) this.redis.off('end', onEnd);
      this.redis.disconnect();
    }
  }
}
