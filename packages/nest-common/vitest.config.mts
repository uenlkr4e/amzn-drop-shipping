import { existsSync } from 'node:fs';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: { fileParallelism: false, testTimeout: 20_000 },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
