import { z } from 'zod';

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value);

const baseEnvShape = {
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  SENTRY_DSN: z.preprocess(emptyToUndefined, z.url().optional()),
  /** Set to production by the Docker images; read only to guard APP_ENV below. */
  NODE_ENV: z.string().optional(),
};

/** A production image must say which deployment it is: the development default would be wrong. */
function requireDeployedAppEnv(
  env: { NODE_ENV?: string; APP_ENV: string },
  ctx: z.RefinementCtx,
): void {
  if (env.NODE_ENV === 'production' && env.APP_ENV !== 'staging' && env.APP_ENV !== 'production') {
    ctx.addIssue({
      code: 'custom',
      path: ['APP_ENV'],
      message: 'must be set to staging or production when NODE_ENV=production',
    });
  }
}

export const apiEnvSchema = z
  .object({
    ...baseEnvShape,
    PORT: z.coerce.number().int().positive().default(3000),
    BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    BETTER_AUTH_URL: z.url(),
    WEB_ORIGIN: z.url(),
    REQUIRE_2FA: z.stringbool().default(true),
  })
  .superRefine((env, ctx) => {
    requireDeployedAppEnv(env, ctx);
    if (env.APP_ENV === 'production' && !env.REQUIRE_2FA) {
      ctx.addIssue({
        code: 'custom',
        path: ['REQUIRE_2FA'],
        message: 'must be true when APP_ENV=production',
      });
    }
  });

export const workerEnvSchema = z
  .object({
    ...baseEnvShape,
    WORKER_GROUPS: z
      .string()
      .transform((value) =>
        value
          .split(',')
          .map((group) => group.trim())
          .filter((group) => group.length > 0),
      )
      .pipe(z.array(z.string()).min(1, 'must list at least one worker group')),
  })
  .superRefine(requireDeployedAppEnv);

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  // Platforms such as Railway/Docker can inject empty variables; treat them as unset.
  const input = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const result = schema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new EnvValidationError(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
