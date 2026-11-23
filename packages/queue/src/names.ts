/** Every BullMQ key is namespaced under this prefix. */
export const BULL_PREFIX = 'dropship';

export const QUEUE_NAMES = {
  system: 'system',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const SYSTEM_JOBS = {
  pruneHeartbeats: 'prune-heartbeats',
} as const;

/** Workers write a heartbeat this often; the API marks a worker stale after 3 missed beats. */
export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;
