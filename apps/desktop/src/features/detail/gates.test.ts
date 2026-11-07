import { describe, expect, it } from 'vitest';
import { testAllowed } from './gates';

const safe = { hasScripts: false, hasHooks: false, hasMcp: false, commands: [] };
describe('testAllowed', () => {
  it('allows a plain skill without Docker', () => expect(testAllowed(safe, false)).toBe(true));
  it.each(['hasScripts', 'hasHooks', 'hasMcp'] as const)('requires Docker for %s', key => {
    expect(testAllowed({ ...safe, [key]: true }, false)).toBe(false);
    expect(testAllowed({ ...safe, [key]: true }, true)).toBe(true);
  });
});
