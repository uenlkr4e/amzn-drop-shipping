import { execFileSync } from 'node:child_process';
import path from 'node:path';

export const E2E_USER = { email: 'e2e-operator@test.local', password: 'e2e-operator-password-123' };

// Runs the API's built user:create script directly with Node (no shell), so arguments with
// spaces survive on Windows, where pnpm can only be spawned through a shell.
export default function globalSetup() {
  execFileSync(
    process.execPath,
    [
      'dist/scripts/create-user.js',
      '--email',
      E2E_USER.email,
      '--name',
      'E2E Operator',
      '--role',
      'operator',
    ],
    {
      cwd: path.resolve(__dirname, '../apps/api'),
      stdio: 'inherit',
      env: { ...process.env, NEW_USER_PASSWORD: E2E_USER.password },
    },
  );
}
