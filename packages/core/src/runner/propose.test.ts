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
test('passes the selected model to the proposal agent', async () => {
  const e = await makeEnv({ script: async () => ({ lines: [line({ kind: 'text', text: '["one","two","three"]' })], code: 0 }) }); root = e.root;
  let model: string | undefined;
  const build = e.agent.buildRun;
  e.agent.buildRun = request => { model = request.model; return build(request); };
  await proposeTasks(e.p, e, { runId: 'proposal', projectDir: root, skill: { name: 'tdd', description: '' }, opts: { agent: 'claude', auth: 'subscription', runs: 'quick' }, model: 'small-model', signal: new AbortController().signal });
  expect(model).toBe('small-model');
});
test('isolated proposal requires a key and installation but not subscription login', async () => {
  const e = await makeEnv({ loggedIn: false, script: async () => ({ lines: [line({ kind: 'text', text: '["one","two","three"]' })], code: 0 }) }); root = e.root;
  const req = { runId: 'proposal', projectDir: root, skill: { name: 'tdd', description: '' }, opts: { agent: 'claude' as const, auth: 'isolated' as const, runs: 'quick' as const, apiKey: 'fake-key' }, signal: new AbortController().signal };
  const detect = e.agent.detect; let detection: unknown; e.agent.detect = async options => { detection = options; return detect(options); };
  expect(await proposeTasks(e.p, e, req)).toEqual(['one', 'two', 'three']);
  expect(detection).toEqual({ installationOnly: true });
  e.calls.length = 0;
  await expect(proposeTasks(e.p, e, { ...req, opts: { ...req.opts, apiKey: '' } })).rejects.toThrow();
  expect(e.calls).toHaveLength(0);
  e.agent.detect = async () => ({ installed: false, loggedIn: false });
  await expect(proposeTasks(e.p, e, req)).rejects.toThrow(); expect(e.calls).toHaveLength(0);
  e.agent.detect = async () => ({ installed: true, loggedIn: false });
  await expect(proposeTasks(e.p, e, { ...req, opts: { ...req.opts, auth: 'subscription' } })).rejects.toThrow(); expect(e.calls).toHaveLength(0);
});
test('never passes a path with a .. segment to the platform fs (Tauri rejects them)', async () => {
  const e = await makeEnv({ script: async () => ({ lines: [line({ kind: 'text', text: '["one","two","three"]' })], code: 0 }) }); root = e.root;
  const fs = e.p.fs as unknown as Record<string, unknown>;
  e.p.fs = new Proxy(fs, { get: (target, key) => {
    const value = target[key as string];
    return typeof value !== 'function' ? value : (...args: unknown[]) => {
      if (args.some(a => typeof a === 'string' && a.split('/').includes('..'))) throw new Error(`cannot traverse directory: ${args[0]}`);
      return (value as (...a: unknown[]) => unknown).apply(target, args);
    };
  } }) as unknown as typeof e.p.fs;
  const tasks = await proposeTasks(e.p, e, { runId: 'proposal', projectDir: root, skill: { name: 'tdd', description: 'test' }, opts: { agent: 'claude', auth: 'subscription', runs: 'quick' }, signal: new AbortController().signal });
  expect(tasks).toEqual(['one', 'two', 'three']);
});
