import { asc, lt } from 'drizzle-orm';
import type { Database } from '../client';
import { workerHeartbeats } from '../schema';

export async function recordHeartbeat(
  db: Database,
  input: { workerGroup: string; instanceId: string; startedAt: Date; seenAt?: Date },
): Promise<void> {
  const seenAt = input.seenAt ?? new Date();
  await db
    .insert(workerHeartbeats)
    .values({
      workerGroup: input.workerGroup,
      instanceId: input.instanceId,
      startedAt: input.startedAt,
      lastSeenAt: seenAt,
    })
    .onConflictDoUpdate({
      target: [workerHeartbeats.workerGroup, workerHeartbeats.instanceId],
      set: { lastSeenAt: seenAt, startedAt: input.startedAt },
    });
}

export async function listHeartbeats(db: Database) {
  return db
    .select()
    .from(workerHeartbeats)
    .orderBy(asc(workerHeartbeats.workerGroup), asc(workerHeartbeats.instanceId));
}

export async function pruneHeartbeats(db: Database, lastSeenBefore: Date): Promise<number> {
  const deleted = await db
    .delete(workerHeartbeats)
    .where(lt(workerHeartbeats.lastSeenAt, lastSeenBefore))
    .returning({ instanceId: workerHeartbeats.instanceId });
  return deleted.length;
}
