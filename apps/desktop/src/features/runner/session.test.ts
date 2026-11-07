import { beforeEach, expect, it, vi } from 'vitest';
import { saveRun, type Platform, type RunResult } from '@somm/core';

beforeEach(() => vi.resetModules());
it('keeps the key out of saved results and clears it on module reload', async () => {
  const session = await import('./session');
  session.setApiKey('test-secret-value');
  const writes: unknown[] = [];
  const p = { db: { execute: async (_sql: string, params: unknown) => { writes.push(params); } } } as unknown as Platform;
  const result = { runId: '1', a: [], b: [], meta: { skill: 'demo', agent: 'codex', auth: 'isolated', runs: 'quick', task: 'test', startedAt: '', finishedAt: '' }, warnings: [], verdict: null } as unknown as RunResult;
  await saveRun(p, result, {});
  expect(JSON.stringify(writes)).not.toContain('test-secret-value');
  vi.resetModules();
  expect((await import('./session')).getApiKey()).toBeUndefined();
});
