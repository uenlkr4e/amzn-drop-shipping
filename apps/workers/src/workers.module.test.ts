import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { resolveWorkerGroups } from './workers.module';

describe('resolveWorkerGroups', () => {
  it('accepts known groups', () => {
    expect(resolveWorkerGroups(['system'])).toEqual(['system']);
  });

  it('fails fast on unknown groups and lists the known ones', () => {
    expect(() => resolveWorkerGroups(['system', 'pricing'])).toThrow(/pricing.*Known: system/);
  });
});
