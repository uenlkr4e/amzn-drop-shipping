import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseEnv as parseDotEnvFile } from 'node:util';

/** Walks up from startDir to the pnpm workspace root looking for a .env file. */
export function findWorkspaceEnvFile(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return undefined;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Loads the workspace .env into process.env for local development and scripts.
 * Variables already set (e.g. by a test harness) win over the file.
 * Never loads a file in staging or production, where Railway injects variables.
 */
export function loadDotEnv(startDir: string = process.cwd()): string | undefined {
  const appEnv = process.env.APP_ENV;
  if (appEnv === 'staging' || appEnv === 'production') return undefined;
  const file = findWorkspaceEnvFile(startDir);
  if (!file) return undefined;
  for (const [key, value] of Object.entries(parseDotEnvFile(readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return file;
}
