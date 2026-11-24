const APP_ORIGIN = 'http://app.invalid';

/** True for C0 control characters and DEL, which URL parsers strip or treat specially. */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** Only allows in-app paths, so a crafted ?redirect= cannot send users to another site. */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (hasControlCharacter(value)) return '/';
  try {
    if (new URL(value, APP_ORIGIN).origin !== APP_ORIGIN) return '/';
  } catch {
    return '/';
  }
  return value;
}
