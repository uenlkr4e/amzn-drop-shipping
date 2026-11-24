import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { PinoLoggerService } from './pino-logger.service';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) lines.push(JSON.parse(line));
      cb();
    },
  });
  const service = new PinoLoggerService(pino({ level: 'trace' }, stream));
  return { lines, service };
}

const STACK = 'Error: boom\n    at handler (/app/src/thing.ts:10:5)';

describe('PinoLoggerService', () => {
  it.each([
    ['log', 30],
    ['warn', 40],
    ['debug', 20],
    ['verbose', 10],
    ['fatal', 60],
  ] as const)('%s writes one JSON line at pino level %i with the Nest context', (method, level) => {
    const { lines, service } = capture();
    service[method]('hello', 'RoutesResolver');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level, msg: 'hello', context: 'RoutesResolver' });
  });

  it('error(message, stack, context) includes the stack and context', () => {
    const { lines, service } = capture();
    service.error('request failed', STACK, 'ExceptionsHandler');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 50,
      msg: 'request failed',
      stack: STACK,
      context: 'ExceptionsHandler',
    });
  });

  it('error(message, stack) without a context keeps the stack', () => {
    const { lines, service } = capture();
    service.error('request failed', STACK);
    expect(lines[0]).toMatchObject({ level: 50, stack: STACK });
    expect(lines[0]).not.toHaveProperty('context');
  });

  it('serializes an Error passed as the message (Nest 11 ExceptionsHandler)', () => {
    const { lines, service } = capture();
    service.error(new Error('boom'), 'ExceptionsHandler');
    expect(lines[0]).toMatchObject({ level: 50, msg: 'boom', context: 'ExceptionsHandler' });
    expect(lines[0]).toHaveProperty('err.stack', expect.stringContaining('Error: boom'));
  });

  it('keeps object messages as structured fields', () => {
    const { lines, service } = capture();
    service.log({ event: 'ready', port: 3000 }, 'Bootstrap');
    expect(lines[0]).toMatchObject({ level: 30, event: 'ready', port: 3000, context: 'Bootstrap' });
  });
});
