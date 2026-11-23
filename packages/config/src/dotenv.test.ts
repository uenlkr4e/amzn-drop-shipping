import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findWorkspaceEnvFile, loadDotEnv } from './dotenv';

function makeWorkspace(withEnv: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'ws-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  if (withEnv) writeFileSync(join(root, '.env'), 'X=1\n');
  const nested = join(root, 'apps', 'api');
  mkdirSync(nested, { recursive: true });
  return { root, nested };
}

describe('findWorkspaceEnvFile', () => {
  it('finds the workspace-root .env from a nested directory', () => {
    const { root, nested } = makeWorkspace(true);
    expect(findWorkspaceEnvFile(nested)).toBe(join(root, '.env'));
  });

  it('stops at the workspace root when there is no .env', () => {
    const { nested } = makeWorkspace(false);
    expect(findWorkspaceEnvFile(nested)).toBeUndefined();
  });
});

describe('loadDotEnv', () => {
  afterEach(() => {
    delete process.env.DOTENV_TEST_A;
    delete process.env.DOTENV_TEST_B;
  });

  it('fills in missing variables but never overrides ones already set', () => {
    const { root, nested } = makeWorkspace(false);
    writeFileSync(join(root, '.env'), 'DOTENV_TEST_A=from-file\nDOTENV_TEST_B=from-file\n');
    process.env.DOTENV_TEST_A = 'from-env';
    expect(loadDotEnv(nested)).toBe(join(root, '.env'));
    expect(process.env.DOTENV_TEST_A).toBe('from-env');
    expect(process.env.DOTENV_TEST_B).toBe('from-file');
  });
});
