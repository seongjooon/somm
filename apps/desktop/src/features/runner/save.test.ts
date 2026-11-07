import { expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Platform, RunResult } from '@somm/core';
import { saveResult, RunSaveError } from './save';
import { cleanupNotices, notifyCleanupError } from './notifications';

const result = (failed: boolean) => ({ runId: 'run', a: [], b: [], warnings: failed ? ['cleanup-failed'] : [], cleanupRecoveryPath: failed ? '/tmp/fake-key/run' : undefined, meta: { skill: 'demo', agent: 'codex', auth: 'isolated', runs: 'quick', task: 'test', startedAt: '', finishedAt: '' }, verdict: null } as unknown as RunResult);
it.each([true, false])('surfaces save failure%s and any cleanup failure after navigation without exposing errors or keys', async failed => {
  cleanupNotices.set([]);
  const p = { db: { execute: async () => { throw new Error('DB fake-key'); } } } as unknown as Platform;
  let caught: unknown;
  try { await saveResult(p, result(failed), {}, 'fake-key'); } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(RunSaveError);
  expect(notifyCleanupError(caught)).toBe(true);
  const notices = get(cleanupNotices);
  expect(notices).toHaveLength(1);
  expect(notices[0].message).toContain('Could not save');
  if (failed) { expect(notices[0].message).toContain('Cleanup failed'); expect(notices[0].message).toContain('/tmp/[REDACTED]/run'); }
  else expect(notices[0].message).not.toContain('Cleanup failed');
  expect(JSON.stringify({ caught, notices })).not.toContain('fake-key');
});
it('does not publish or throw on a successful save', async () => {
  cleanupNotices.set([]);
  const p = { db: { execute: async () => {} } } as unknown as Platform;
  await expect(saveResult(p, result(true), {}, 'fake-key')).resolves.toBeUndefined();
  expect(get(cleanupNotices)).toEqual([]);
});
