import type { BetterAuthOptions } from 'better-auth';
import type { Logger } from 'pino';

type BetterAuthLogger = NonNullable<BetterAuthOptions['logger']>;
type BetterAuthLevel = NonNullable<BetterAuthLogger['level']>;

/** Better Auth's level threshold that matches the pino logger's, so pino stays the filter. */
function thresholdFor(logger: Logger): BetterAuthLevel {
  if (logger.isLevelEnabled('debug')) return 'debug';
  if (logger.isLevelEnabled('info')) return 'info';
  if (logger.isLevelEnabled('warn')) return 'warn';
  return 'error';
}

/** Routes Better Auth's own messages (otherwise coloured console text) through pino as JSON. */
export function betterAuthLogger(logger: Logger): BetterAuthLogger {
  return {
    level: thresholdFor(logger),
    log: (level, message, ...args) => {
      const err = args.find((arg) => arg instanceof Error);
      const details = args.filter((arg) => arg !== err);
      logger[level](
        {
          component: 'better-auth',
          ...(err ? { err } : {}),
          ...(details.length > 0 ? { details } : {}),
        },
        message,
      );
    },
  };
}
