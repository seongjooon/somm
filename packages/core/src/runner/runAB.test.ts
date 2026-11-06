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
  const r = await runAB(e.p, e, req(e));
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
