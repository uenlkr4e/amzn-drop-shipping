import { describe, expect, it } from 'vitest';
import { safeRedirect } from './redirect';

describe('safeRedirect', () => {
  it('keeps same-site paths', () => {
    expect(safeRedirect('/ops?tab=queues')).toBe('/ops?tab=queues');
  });

  it.each([
    ['https://evil.example'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['javascript:alert(1)'],
    [''],
    [undefined],
    [42],
  ])('falls back to / for %s', (input) => {
    expect(safeRedirect(input)).toBe('/');
  });
});
