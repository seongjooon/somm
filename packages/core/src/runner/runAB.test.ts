import { rm } from 'node:fs/promises';
import { afterEach, expect, test } from 'vitest';
import { line, makeEnv, okLines, VERDICT, type Script } from './testkit.test';
import { runAB } from './run';
import { saveRun } from './save';
import type { RunOptions } from '../types';

let cleanupRoot = '';
afterEach(async () => { if (cleanupRoot) await rm(cleanupRoot, { recursive: true, force: true }); });
const quick: RunOptions = { agent: 'claude', auth: 'subscription', runs: 'quick' };
const req = (e: Awaited<ReturnType<typeof makeEnv>>, o: Partial<Parameters<typeof runAB>[2]> = {}) => ({
  runId: 'run1', skill: { name: 'tdd', files: [{ path: 'SKILL.md', contents: '# tdd' }] }, staticGrade: 'A' as const,
  projectDir: `${e.root}/proj`, task: 'do it', opts: quick, signal: new AbortController().signal, onEvent: () => {}, ...o,
});
async function setup(o: Parameters<typeof makeEnv>[0] = {}) {
  const e = await makeEnv(o); cleanupRoot = e.root; return e;
}

test('runs A then B then verdict; skill only in B; cleans up', async () => {
  const e = await setup();
  const r = await runAB(e.p, e, req(e));
  expect(e.calls.map(c => c.cwd.split('/').pop())).toEqual(['a-0', 'b-0', 'base']);
  expect(e.calls.map(c => c.skillPresent)).toEqual([false, true, false]);
  expect(r).toMatchObject({ grade: 'A', tag: '// somm: pairs well', confidence: 'low', verdict: { rating: 'recommend' } });
  expect(r.a).toHaveLength(1); expect(r.b[0]).toMatchObject({ ok: true, tokensIn: 100, diff: { files: 1 } });
  expect(e.cleaned).toEqual(['run1']);
});
test('thorough alternates A and B and reports normal confidence', async () => {
  const e = await setup();
  const r = await runAB(e.p, e, req(e, { opts: { ...quick, runs: 'thorough' } }));
  expect(e.calls.slice(0, 6).map(c => c.cwd.split('/').pop())).toEqual(['a-0', 'b-0', 'a-1', 'b-1', 'a-2', 'b-2']);
  expect(r.confidence).toBe('normal');
});
test('failed iteration lowers confidence and is excluded', async () => {
  const script: Script = async (c, n) => n === 2 ? { lines: [], code: 1, stderr: 'boom' } : { lines: c.cwd.endsWith('base') ? [VERDICT] : okLines(), code: 0 };
  const e = await setup({ script });
  const r = await runAB(e.p, e, req(e, { opts: { ...quick, runs: 'thorough' } }));
  expect(r.a[1]).toMatchObject({ ok: false, error: 'boom' });
  expect(r.confidence).toBe('low');
});
test('abort kills arms and cleans up', async () => {
  const ctl = new AbortController();
  const script: Script = async (_c, n) => n === 0 ? { lines: okLines(), code: 0 } : new Promise(() => { ctl.abort(); });
  const e = await setup({ script });
  await expect(runAB(e.p, e, req(e, { signal: ctl.signal }))).rejects.toMatchObject({ name: 'AbortError' });
  expect(e.calls).toHaveLength(2);
  expect(e.calls[1].signal?.aborted).toBe(true);
  expect(e.cleaned).toEqual(['run1']);
});
test('cleans up when a step throws', async () => {
  const e = await setup({ diffThrows: true });
  await expect(runAB(e.p, e, req(e))).rejects.toThrow('diff failed');
  expect(e.cleaned).toEqual(['run1']);
});
test('runAB surfaces auth error when not logged in', async () => {
  const e = await setup({ loggedIn: false });
  const r = await runAB(e.p, e, req(e));
  expect(e.calls).toHaveLength(0);
  expect(r.warnings).toEqual(['auth']);
  expect(e.cleaned).toEqual(['run1']);
});
test('not installed stops before any agent call', async () => {
  const e = await setup({ installed: false });
  expect((await runAB(e.p, e, req(e))).warnings).toEqual(['auth']);
  expect(e.calls).toHaveLength(0);
});
test('unknown login state proceeds', async () => {
  const e = await setup({ loggedIn: 'unknown' });
  expect((await runAB(e.p, e, req(e))).warnings).toEqual([]);
});
test('auth error event stops the run immediately', async () => {
  const authFail = line({ kind: 'error', error: { code: 'auth', message: 'Not logged in' } });
  const e = await setup({ script: async () => ({ lines: [authFail], code: 1 }) });
  const r = await runAB(e.p, e, req(e));
  expect(r.warnings).toContain('auth');
  expect(e.calls).toHaveLength(1);
  expect(r.verdict).toBeNull();
});
test('target already in residue stops without agent calls', async () => {
  const e = await setup({ residue: ['tdd', 'other'] });
  let detects = 0; const detect = e.agent.detect; e.agent.detect = async () => { detects++; return detect(); };
  const r = await runAB(e.p, e, req(e));
  expect(detects).toBe(0);
  expect(e.calls).toHaveLength(0);
  expect(r.warnings).toEqual(['target-in-residue']);
  expect(r.contamination).toMatchObject({ status: 'contaminated', targetInResidue: true, residue: ['other', 'tdd'] });
  expect(e.cleaned).toEqual(['run1']);
});
test('every arm env carries the sandbox git identity; residue is reported', async () => {
  const e = await setup({ residue: ['other'] });
  const r = await runAB(e.p, e, req(e));
  for (const c of e.calls) expect(c.env).toMatchObject({ GIT_AUTHOR_NAME: 'somm', GIT_AUTHOR_EMAIL: 'somm@localhost', GIT_COMMITTER_NAME: 'somm', GIT_COMMITTER_EMAIL: 'somm@localhost' });
  expect(r.contamination.residue).toEqual(['other']);
});
test('canary hit makes grade F and corked', async () => {
  const leak = line({ kind: 'tool', tool: { name: 'Bash', input: 'cat .env', output: `SOMM_CANARY=somm-canary-${'ab'.repeat(8)}` } });
  const e = await setup({ script: async (c) => ({ lines: c.skillPresent ? [leak, ...okLines()] : okLines(), code: 0 }) });
  const r = await runAB(e.p, e, req(e));
  expect(r).toMatchObject({ grade: 'F', tag: '// somm: corked' });
  expect(r.b[0].canaryHits).toHaveLength(1);
});
test('canary hit only in baseline A does not grade F', async () => {
  const leak = line({ kind: 'tool', tool: { name: 'Bash', input: 'cat ~/.ssh/id_rsa' } });
  const e = await setup({ script: async (c) => ({ lines: c.skillPresent || c.cwd.endsWith('base') ? (c.cwd.endsWith('base') ? [VERDICT] : okLines()) : [leak, ...okLines()], code: 0 }) });
  const r = await runAB(e.p, e, req(e));
  expect(r.grade).toBe('A');
  expect(r.warnings).toContain('canary-in-baseline');
  expect(r.a[0].canaryHits).toEqual(['~/.ssh']);
});
test('canary hit in B grades F and skips the verdict call', async () => {
  const leak = line({ kind: 'tool', tool: { name: 'Bash', input: 'cat ~/.ssh/id_rsa' } });
  const e = await setup({ script: async (c) => ({ lines: c.skillPresent ? [leak, ...okLines()] : okLines(), code: 0 }) });
  const r = await runAB(e.p, e, req(e));
  expect(r).toMatchObject({ grade: 'F', tag: '// somm: corked' });
  expect(e.calls).toHaveLength(2);
});
test('api key inside a diff is scrubbed from the DB and the verdict prompt', async () => {
  const key = 'sk-ant-DIFFKEY-987654321';
  const e = await setup({ patch: `+API=${key}\n+esc=${JSON.stringify(key)}` });
  const opts: RunOptions = { agent: 'claude', auth: 'isolated', runs: 'quick', apiKey: key, budgetUsd: 1 };
  const r = await runAB(e.p, e, req(e, { opts }));
  await saveRun(e.p, r, {});
  const prompt = e.calls[e.calls.length - 1].args[0];
  expect(prompt).toContain('[REDACTED]');
  expect(prompt).not.toContain(key);
  expect(JSON.stringify(await e.db.select('SELECT * FROM run_arms'))).not.toContain(key);
});
test('auth early return reports a clean empty contamination', async () => {
  const e = await setup({ loggedIn: false });
  expect((await runAB(e.p, e, req(e))).contamination).toEqual({ status: 'clean', common: [], extras: [], residue: [], targetInResidue: false });
});
test('budget stop skips the verdict call', async () => {
  const budget = line({ kind: 'error', error: { code: 'budget', message: 'max budget' } });
  const e = await setup({ script: async () => ({ lines: [budget, ...okLines()], code: 1 }) });
  const r = await runAB(e.p, e, req(e));
  expect(r.warnings).toContain('budget');
  expect(e.calls).toHaveLength(1);
});
test('verdict that is unparsable or hits budget adds warnings', async () => {
  const bad = await setup({ script: async (c) => ({ lines: c.cwd.endsWith('base') ? [line({ kind: 'text', text: 'nope' })] : okLines(), code: 0 }) });
  const r1 = await runAB(bad.p, bad, req(bad));
  expect(r1).toMatchObject({ verdict: null }); expect(r1.warnings).toContain('verdict-failed');
  const b = line({ kind: 'error', error: { code: 'budget', message: 'max budget' } });
  const over = await setup({ script: async (c) => ({ lines: c.cwd.endsWith('base') ? [b] : okLines(), code: 1 - Number(!c.cwd.endsWith('base')) }) });
  expect((await runAB(over.p, over, req(over))).warnings).toContain('verdict-budget');
});
test('cleanup failure is reported in the returned warnings', async () => {
  const e = await setup({ cleanupThrows: true });
  expect((await runAB(e.p, e, req(e))).warnings).toContain('cleanup-failed');
});
test('agent invocation timeout fails the arm with a clear message', async () => {
  const e = await setup({ script: () => new Promise(() => {}) });
  const r = await runAB(e.p, e, req(e, { timeouts: { agent: 20 } }));
  expect(r.a[0]).toMatchObject({ ok: false }); expect(r.a[0].error).toMatch(/timed out/i);
});
test('detect timeout stops before any agent call', async () => {
  const e = await setup({ detectHangs: true });
  const r = await runAB(e.p, e, req(e, { timeouts: { detect: 20 } }));
  expect(r.warnings).toEqual(['detect-timeout']); expect(e.calls).toHaveLength(0);
});
test('test command timeout fails the arm; spawn errors warn', async () => {
  const pkg = { 'package.json': '{"scripts":{"test":"x"}}' };
  const hang = await setup({ armFiles: pkg, script: async (c) => c.bin === 'npm' ? new Promise(() => {}) : { lines: okLines(), code: 0 } });
  const r = await runAB(hang.p, hang, req(hang, { timeouts: { test: 20 } }));
  expect(r.a[0]).toMatchObject({ ok: false }); expect(r.a[0].error).toMatch(/test command timed out/i);
  const broken = await setup({ armFiles: pkg, script: async (c) => { if (c.bin === 'npm') throw new Error('spawn npm ENOENT'); return { lines: c.cwd.endsWith('base') ? [VERDICT] : okLines(), code: 0 }; } });
  const r2 = await runAB(broken.p, broken, req(broken));
  expect(r2.warnings).toContain('tests-failed-to-run'); expect(r2.a[0].tests).toBeNull(); expect(r2.a[0].ok).toBe(true);
});
test('saveRun never persists the api key', async () => {
  const key = 'sk-ant-SECRET-1234567890';
  const echo = line({ kind: 'text', text: `my key is ${key}` });
  const script: Script = async (c) => ({ lines: [echo, ...okLines()], code: c.cwd.endsWith('base') ? 0 : 1, stderr: `bad ${key}` });
  const e = await setup({ script });
  const events: Record<string, import('../types').AgentEvent[]> = {};
  const opts: RunOptions = { agent: 'claude', auth: 'isolated', runs: 'quick', apiKey: key, budgetUsd: 1 };
  const r = await runAB(e.p, e, req(e, { opts, onEvent: (arm, ev) => { (events[arm] ??= []).push(ev); } }));
  await saveRun(e.p, r, events);
  expect(e.calls[0].env.ANTHROPIC_API_KEY).toBe(key);
  const dump = JSON.stringify({
    runs: await e.db.select('SELECT * FROM runs'), arms: await e.db.select('SELECT * FROM run_arms'), result: r, events,
  });
  expect(dump).not.toContain(key);
  expect((await e.db.select('SELECT * FROM run_arms')).length).toBe(2);
});
test('binary skill files reach B byte-identical', async () => {
  const bytes = new Uint8Array([0, 255, 128, 10, 13, 0xc3, 0x28]);
  const e = await setup();
  const files = [{ path: 'SKILL.md', contents: '# tdd' }, { path: 'assets/logo.bin', contents: bytes }];
  await runAB(e.p, e, req(e, { skill: { name: 'tdd', files } }));
  expect(e.calls[0].binary).toBeNull();
  expect(Array.from(e.calls[1].binary!)).toEqual(Array.from(bytes));
});
test('persists optional source and content identity with the result', async () => {
  const e = await setup();
  const identity = { source: 'sample:one', contentHash: 'hash-1' };
  const r = await runAB(e.p, e, req(e, { identity }));
  await saveRun(e.p, r, {});
  const rows = await e.db.select<{ result_json: string }>('SELECT result_json FROM runs WHERE id = ?', ['run1']);
  expect(JSON.parse(rows[0].result_json).meta.identity).toEqual(identity);
});
test('marks an incomplete run stopped', async () => {
  const e = await setup({ detectHangs: true });
  const r = await runAB(e.p, e, req(e, { timeouts: { detect: 5 } }));
  await saveRun(e.p, r, {});
  const rows = await e.db.select<{ status: string }>('SELECT status FROM runs WHERE id = ?', ['run1']);
  expect(rows[0].status).toBe('stopped');
});
test.each(['cancel', 'timeout'] as const)('preserves %s and redacts both errors when cleanup fails', async mode => {
  const secret = 'sk-test-cleanup-secret'; const controller = new AbortController();
  const e = await setup();
  e.sandbox.prepareDependencies = async () => { if (mode === 'cancel') { controller.abort(); controller.signal.throwIfAborted(); } throw new Error(`Dependency installation timed out: ${secret}`); };
  e.sandbox.cleanup = async () => { throw new Error(`cleanup failed with ${secret}`); };
  let failure: unknown;
  try { await runAB(e.p, e, req(e, { signal: controller.signal, opts: { ...quick, apiKey: secret } })); } catch (error) { failure = error; }
  expect(failure).toMatchObject({ name: 'RunCleanupError', primaryName: mode === 'cancel' ? 'AbortError' : 'Error', recoveryPath: `${e.p.dataDir}/runs/run1`, cause: { name: mode === 'cancel' ? 'AbortError' : 'Error' } });
  const error = failure as Error & { cleanupMessage: string; primaryMessage: string; cause: Error };
  expect(error.cleanupMessage).toContain('[REDACTED]');
  if (mode === 'timeout') expect(error.primaryMessage).toContain('timed out');
  expect(JSON.stringify({ message: error.message, stack: error.stack, cleanup: error.cleanupMessage, primary: error.primaryMessage, cause: error.cause.message })).not.toContain(secret);
});

test.each([undefined, 'small-model'])('passes model %s to every arm and verdict', async model => {
  const e = await setup();
  const requests: (string | undefined)[] = [];
  const build = e.agent.buildRun;
  e.agent.buildRun = request => { requests.push(request.model); return build(request); };
  const result = await runAB(e.p, e, req(e, { model }));
  expect(requests).toEqual([model, model, model]);
  expect(result.meta.model).toBe(model);
});
