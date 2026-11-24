import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Playwright loads this config as CommonJS (the package is not ESM), so use __dirname.
const rootEnv = path.resolve(__dirname, '../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// The preview server runs on 4173; the API must treat that as the browser origin.
process.env.BETTER_AUTH_URL = 'http://localhost:4173';
process.env.WEB_ORIGIN = 'http://localhost:4173';
process.env.REQUIRE_2FA = 'false';

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @dropship/api start',
      url: 'http://localhost:3000/api/health/ready',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @dropship/web preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
