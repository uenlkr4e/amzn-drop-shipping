import './instrument';
import 'reflect-metadata';
import { parseEnv, workerEnvSchema } from '@dropship/config';
import { NestFactory } from '@nestjs/core';
import { WorkersModule } from './workers.module';

async function bootstrap() {
  const env = parseEnv(workerEnvSchema);
  const app = await NestFactory.createApplicationContext(WorkersModule.forRoot(env));
  // SIGTERM from Railway closes BullMQ workers (finishing active jobs) and the DB pool.
  app.enableShutdownHooks();
  await app.init();
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
