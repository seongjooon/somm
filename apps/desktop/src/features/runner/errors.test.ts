import { expect, it } from 'vitest';
import { RunCleanupError, type Platform } from '@somm/core';
import { runnerError } from './errors';
import { clearApiKey, setApiKey, changeAuth, getApiKey } from './session';
it('shows cleanup and recovery even when cancelled and redacts the key', () => {
  setApiKey('example-key');
  const p = { dataDir: '/tmp/example-key' } as Platform;
  const error = new RunCleanupError(p, 'run-1', 'example-key', new DOMException('Cancelled', 'AbortError'), new Error('failed example-key'));
  const message = runnerError(error, true);
  expect(message).toContain('Cleanup failed'); expect(message).toContain('Recovery path'); expect(message).not.toContain('example-key');
  clearApiKey();
});
it('clears a hidden key when switching to subscription', () => {
  setApiKey('example-key'); changeAuth('isolated'); expect(getApiKey()).toBe('example-key');
  changeAuth('subscription'); expect(getApiKey()).toBeUndefined();
});
