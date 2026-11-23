import type { Database } from '@dropship/database';
import { DATABASE, REDIS } from '@dropship/nest-common';
import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { Public } from '../auth/public.decorator';

type CheckResult = 'ok' | 'error';

const CHECK_TIMEOUT_MS = 2_000;

async function check(fn: () => Promise<unknown>): Promise<CheckResult> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS);
      }),
    ]);
    return 'ok';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timer);
  }
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready() {
    const [database, redis] = await Promise.all([
      check(() => this.db.execute(sql`select 1`)),
      this.checkRedis(),
    ]);
    const checks = { database, redis };
    if (Object.values(checks).some((result) => result !== 'ok')) {
      throw new ServiceUnavailableException({ status: 'error', checks });
    }
    return { status: 'ok', checks };
  }

  /**
   * The client retries commands forever while reconnecting (maxRetriesPerRequest: null, for
   * BullMQ), so a PING sent while Redis is down would sit in the offline queue indefinitely.
   * Only ping when connected, or when the lazy client has never connected ('wait'), so the
   * first probe opens the connection.
   */
  private checkRedis(): Promise<CheckResult> {
    const { status } = this.redis;
    if (status !== 'ready' && status !== 'wait') return Promise.resolve('error');
    return check(() => this.redis.ping());
  }
}
