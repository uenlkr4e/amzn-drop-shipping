import { describe, expect, it } from 'vitest';
import { safeRedirect } from './redirect';

const APP = 'http://app.invalid';

describe('safeRedirect', () => {
  it('keeps same-site paths', () => {
    expect(safeRedirect('/ops?tab=queues')).toBe('/ops?tab=queues');
  });

  it.each([
    ['https://evil.example'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['/\t/evil.example'],
    ['/\n/evil.example'],
    ['/ops\u007f'],
    ['javascript:alert(1)'],
    [''],
    [undefined],
    [42],
  ])('falls back to / for %j', (input) => {
    expect(safeRedirect(input)).toBe('/');
  });

  it('only ever returns same-origin targets for encoded slashes', () => {
    const result = safeRedirect('/%2F%2Fevil');
    expect(new URL(result, APP).origin).toBe(APP);
  });
});
