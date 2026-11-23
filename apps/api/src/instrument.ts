import { loadDotEnv } from '@dropship/config';
import * as Sentry from '@sentry/nestjs';

loadDotEnv();

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.APP_ENV ?? 'development',
    tracesSampleRate: 0,
    // Sentry v11 replaced `sendDefaultPii` with `dataCollection`, whose defaults collect more.
    // Keep PII out: no user info, cookies, HTTP bodies (auth payloads) or local variables.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      stackFrameVariables: false,
    },
  });
}
