import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { apiEnvSchema, loadDotEnv, parseEnv } from '@dropship/config';
import { createApp } from '../app.factory';
import { buildOpenApiDocument } from '../swagger';

/** Writes apps/api/openapi.json. Building the app does not need Postgres or Redis to be reachable. */
async function main() {
  loadDotEnv();
  const env = parseEnv(apiEnvSchema, { ...process.env, LOG_LEVEL: 'silent' });
  const app = await createApp(env);
  try {
    const document = buildOpenApiDocument(app);
    const target = resolve(__dirname, '../../openapi.json');
    writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
    console.log(`Wrote ${target}`);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
