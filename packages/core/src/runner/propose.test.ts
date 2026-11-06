import { afterEach, expect, test } from 'vitest';
import { rm } from 'node:fs/promises';
import { makeEnv, line } from './testkit.test';
import { proposeTasks } from './propose';
let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
test('proposes three tasks using the selected agent in a sandbox and cleans up', async () => {
  const e = await makeEnv({ script: async () => ({ lines: [line({ kind: 'text', text: '["one","two","three"]' })], code: 0 }) }); root = e.root;
  const tasks = await proposeTasks(e.p, e, { runId: 'proposal', projectDir: root, skill: { name: 'tdd', description: 'test' }, opts: { agent: 'claude', auth: 'subscription', runs: 'quick' }, signal: new AbortController().signal });
  expect(tasks).toEqual(['one', 'two', 'three']); expect(e.calls).toHaveLength(1); expect(e.calls[0].args[0]).toContain('tdd'); expect(e.cleaned).toEqual(['proposal']);
});
test('abort stops the proposal process and cleans up', async () => {
  const controller = new AbortController();
  const e = await makeEnv({ script: async () => { controller.abort(); return new Promise(() => {}); } }); root = e.root;
  await expect(proposeTasks(e.p, e, { runId: 'proposal', projectDir: root, skill: { name: 'tdd', description: '' }, opts: { agent: 'claude', auth: 'subscription', runs: 'quick' }, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(e.calls[0].signal?.aborted).toBe(true); expect(e.cleaned).toEqual(['proposal']);
});
test('rejects the target in shared residue before detection or agent calls and cleans up', async () => {
  const e = await makeEnv({ residue: ['tdd'] }); root = e.root;
  let detections = 0; const detect = e.agent.detect; e.agent.detect = async () => { detections++; return detect(); };
  await expect(proposeTasks(e.p, e, { runId: 'proposal', projectDir: root, skill: { name: 'tdd', description: '' }, opts: { agent: 'claude', auth: 'subscription', runs: 'quick' }, signal: new AbortController().signal })).rejects.toMatchObject({ name: 'TargetInResidueError', skillName: 'tdd' });
  expect(detections).toBe(0); expect(e.calls).toHaveLength(0); expect(e.cleaned).toEqual(['proposal']);
});
test.each(['cancel', 'timeout'] as const)('preserves proposal %s when cleanup fails without leaking a key', async mode => {
  const key = 'sk-test-proposal-secret'; const controller = new AbortController(); const e = await makeEnv(); root = e.root;
  e.sandbox.prepareDependencies = async () => { if (mode === 'cancel') { controller.abort(); controller.signal.throwIfAborted(); } throw new Error(`timeout ${key}`); };
  e.sandbox.cleanup = async () => { throw new Error(`cleanup ${key}`); };
  let failure: unknown;
  try { await proposeTasks(e.p, e, { runId: 'proposal', projectDir: root, skill: { name: 'tdd', description: '' }, opts: { agent: 'claude', auth: 'isolated', runs: 'quick', apiKey: key, budgetUsd: 1 }, signal: controller.signal }); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ name: 'RunCleanupError', primaryName: mode === 'cancel' ? 'AbortError' : 'Error', recoveryPath: `${e.p.dataDir}/runs/proposal` });
  const err = failure as Error & { cleanupMessage: string; primaryMessage: string; cause: Error };
  expect(err.cleanupMessage).toContain('[REDACTED]'); expect(JSON.stringify({ message: err.message, cause: err.cause.message, cleanup: err.cleanupMessage, stack: err.stack })).not.toContain(key);
});
test('preserves and redacts target residue details when cleanup fails', async () => {
  const key = 'sk-fake-residue-secret'; const e = await makeEnv({ residue: ['tdd', `other-${key}`] }); root = e.root;
  e.sandbox.cleanup = async () => { throw new Error(`failed ${key}`); };
  let failure: unknown;
  try { await proposeTasks(e.p, e, { runId: 'proposal', projectDir: root, skill: { name: 'tdd', description: '' }, opts: { agent: 'claude', auth: 'isolated', runs: 'quick', apiKey: key, budgetUsd: 1 }, signal: new AbortController().signal }); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ name: 'RunCleanupError', primaryName: 'TargetInResidueError', primaryDetails: { skillName: 'tdd' }, recoveryPath: `${e.p.dataDir}/runs/proposal` });
  const error = failure as Error & { primaryDetails: { residue: string[] }; cause: Error & { skillName: string; residue: string[] }; cleanupMessage: string };
  expect(error.cause.name).toBe('TargetInResidueError'); expect(error.cause.skillName).toBe('tdd');
  for (const residue of [error.primaryDetails.residue, error.cause.residue]) expect([...residue].sort()).toEqual(['other-[REDACTED]', 'tdd']);
  expect(error.cleanupMessage).toContain('[REDACTED]'); expect(JSON.stringify(failure)).not.toContain(key); expect(error.message).not.toContain(key);
});
