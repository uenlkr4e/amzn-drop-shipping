import './instrument';
import 'reflect-metadata';
import { apiEnvSchema, parseEnv } from '@dropship/config';
import { createApp } from './app.factory';

async function bootstrap() {
  const env = parseEnv(apiEnvSchema);
  const app = await createApp(env);
  // '::' listens on IPv6 and IPv4; Railway private networking uses IPv6.
  await app.listen(env.PORT, '::');
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
