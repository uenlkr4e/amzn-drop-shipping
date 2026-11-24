import type { LoggerService } from '@nestjs/common';
import type { Level, Logger } from 'pino';

/** Same check Nest's ConsoleLogger uses to tell a stack trace from a context name. */
const STACK_TRACE = /^(.)+\n\s+at .+:\d+:\d+/;

/**
 * Nest LoggerService that writes through pino, so framework messages (startup, route mapping,
 * ExceptionsHandler 500s) are JSON lines with the same redaction and base fields as the rest.
 * Nest passes the logger context as the last string argument; it becomes the `context` field.
 */
export class PinoLoggerService implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write('trace', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  private write(level: Level, message: unknown, params: unknown[]): void {
    const rest = params.filter((param) => param !== undefined);
    const fields: Record<string, unknown> = {};
    const last = rest.at(-1);
    if (typeof last === 'string' && !STACK_TRACE.test(last)) {
      fields.context = last;
      rest.pop();
    }
    const extra: unknown[] = [];
    for (const param of rest) {
      if (typeof param === 'string' && STACK_TRACE.test(param)) fields.stack = param;
      else if (param instanceof Error) fields.err = param;
      else extra.push(param);
    }
    if (extra.length > 0) fields.params = extra;

    if (message instanceof Error) {
      this.logger[level]({ ...fields, err: message }, message.message);
    } else if (typeof message === 'object' && message !== null) {
      this.logger[level]({ ...(message as Record<string, unknown>), ...fields });
    } else {
      this.logger[level](fields, String(message));
    }
  }
}
