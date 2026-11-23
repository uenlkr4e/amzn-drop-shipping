import type { ApiEnv } from '@dropship/config';
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Dropship Platform API')
    .setVersion('0.1.0')
    .addCookieAuth('better-auth.session_token')
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Interactive docs at /api/docs, outside production only. */
export function setupSwagger(app: INestApplication, env: ApiEnv): void {
  if (env.APP_ENV === 'production') return;
  SwaggerModule.setup('api/docs', app, buildOpenApiDocument(app));
}
