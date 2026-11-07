import { expect, it } from 'vitest';
import { get } from 'svelte/store';
import { RunCleanupError, type Platform } from '@somm/core';
import { cleanupNotices, dismissCleanupNotice, notifyCleanupError } from './notifications';
it('retains a redacted cleanup failure across navigation and dismisses it once', () => {
  cleanupNotices.set([]);
  const err = new RunCleanupError({ dataDir: '/tmp/work' } as Platform, 'run1', 'fake-secret', new DOMException('cancelled', 'AbortError'), new Error('fake-secret'));
  expect(notifyCleanupError(err)).toBe(true);
  const [notice] = get(cleanupNotices);
  expect(notice.message).toContain('/tmp/work/runs/run1'); expect(notice.message).not.toContain('fake-secret');
  expect(get(cleanupNotices)).toHaveLength(1);
  dismissCleanupNotice(notice.id); expect(get(cleanupNotices)).toEqual([]);
  expect(notifyCleanupError(new Error('normal'))).toBe(false);
});
