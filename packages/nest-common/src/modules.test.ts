import 'reflect-metadata';
import type { Database, DatabaseHandle } from '@dropship/database';
import { assertTestDatabaseUrl } from '@dropship/database/testing';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';
import { DATABASE, DATABASE_HANDLE, DatabaseModule } from './database.module';
import { REDIS, RedisModule } from './redis.module';

describe('DatabaseModule and RedisModule', () => {
  it('provide working clients and close them on shutdown', async () => {
    const redisUrl = process.env.TEST_REDIS_URL;
    if (!redisUrl) throw new Error('TEST_REDIS_URL must be set');
    const app = await Test.createTestingModule({
      imports: [
        DatabaseModule.forRoot(assertTestDatabaseUrl(process.env.TEST_DATABASE_URL)),
        RedisModule.forRoot(redisUrl),
      ],
    }).compile();
    await app.init();

    const db = app.get<Database>(DATABASE);
    const result = await db.execute(sql`select 1 as one`);
    expect(result.rows[0]).toEqual({ one: 1 });

    const redis = app.get<Redis>(REDIS);
    expect(await redis.ping()).toBe('PONG');

    const handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    await app.close();
    expect(handle.pool.ended).toBe(true);
    expect(redis.status).toBe('end');
  });
});
