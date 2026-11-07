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
it('clears the input and session when a proposal is cancelled', async () => {
  const session = await import('./session');
  session.setApiKey('secret');
  const input = { value: 'secret' };
  session.resetKey(input);
  expect(input.value).toBe('');
  expect(session.getApiKey()).toBeUndefined();
});
it('retains key after successful proposal and clears on failure', async () => {
  const session = await import('./session');
  session.setApiKey('valid-key');
  session.finishProposal(true);
  expect(session.getApiKey()).toBe('valid-key');
  session.finishProposal(false);
  expect(session.getApiKey()).toBeUndefined();
});
it('requires isolated keys to have at least eight characters', async () => {
  const session = await import('./session');
  expect(session.validKey('short')).toBe(false);
  expect(session.validKey('long-enough')).toBe(true);
});
