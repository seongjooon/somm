import { rm } from 'node:fs/promises';
import { afterEach, expect, test } from 'vitest';
import { nodeFs } from '../node/fs';
import { runArm } from './arm';
import { makeScrub } from './exec';
import { line, makeEnv, type Script } from './testkit.test';

let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
async function arm(script: Script, agent: 'claude' | 'codex' = 'claude', files: Record<string, string> = {}) {
  const e = await makeEnv({ script }); root = e.root;
  const dir = `${root}/arm`;
  for (const [f, c] of Object.entries(files)) await nodeFs.writeText(`${dir}/${f}`, c).catch(async () => { await nodeFs.mkdirp(dir); await nodeFs.writeText(`${dir}/${f}`, c); });
  await nodeFs.mkdirp(dir);
  return runArm(e.p, e.agent, e.sandbox, { name: 'a-0', dir, tmpHome: `${root}/home`, task: 't', signal: new AbortController().signal,
    opts: { agent, auth: 'subscription', runs: 'quick' }, scrub: makeScrub(), canaries: [], cleanupPaths: [], onEvent: () => {} });
}
test('non-zero exit without events fails the arm with the stderr text', async () => {
  const out = await arm(async () => ({ lines: [], code: 2, stderr: 'kaput' }));
  expect(out.metrics).toMatchObject({ ok: false, error: 'kaput', tests: null });
});
test('exit code is the fallback failure message', async () => {
  expect((await arm(async () => ({ lines: [], code: 4 }))).metrics.error).toBe('Exited with code 4');
});
test('error event message wins over exit code', async () => {
  const err = line({ kind: 'error', error: { code: 'other', message: 'model overloaded' } });
  expect((await arm(async () => ({ lines: [err], code: 1, stderr: 'x' }))).metrics.error).toBe('model overloaded');
});
test('codex inventory merges skills from the temp HOME', async () => {
  await nodeFs.mkdirp('/tmp').catch(() => {});
  const e = await makeEnv({ script: async () => ({ lines: [line({ kind: 'usage', usage: { input: 1, output: 2 } })], code: 0 }) }); root = e.root;
  await nodeFs.mkdirp(`${root}/arm/.claude/skills/own`); await nodeFs.writeText(`${root}/arm/.claude/skills/own/SKILL.md`, '');
  await nodeFs.mkdirp(`${root}/home/.claude/skills/fromhome`);
  const out = await runArm(e.p, e.agent, e.sandbox, { name: 'a-0', dir: `${root}/arm`, tmpHome: `${root}/home`, task: 't', signal: new AbortController().signal,
    opts: { agent: 'codex', auth: 'subscription', runs: 'quick' }, scrub: makeScrub(), canaries: [], cleanupPaths: [], onEvent: () => {} });
  expect(out.metrics.inventory.skills).toEqual(['fromhome', 'own']);
});
test('passes the detected test command to the agent', async () => {
  const e = await makeEnv({ script: async () => ({ lines: [], code: 0 }) }); root = e.root;
  const dir = `${root}/arm`;
  await nodeFs.mkdirp(dir);
  await nodeFs.writeText(`${dir}/package.json`, JSON.stringify({ scripts: { test: 'vitest' } }));
  let command: string[] | undefined;
  const build = e.agent.buildRun;
  e.agent.buildRun = request => { command = request.allowedBash; return build(request); };
  await runArm(e.p, e.agent, e.sandbox, { name: 'a-0', dir, tmpHome: `${root}/home`, task: 't', signal: new AbortController().signal,
    opts: { agent: 'claude', auth: 'subscription', runs: 'quick' }, scrub: makeScrub(), canaries: [], cleanupPaths: [], onEvent: () => {} });
  expect(command).toEqual(['npm', 'test']);
});
test('notifies live on a canary hit without exposing its token', async () => {
  const token = 'fake-canary-value';
  const e = await makeEnv({ script: async () => ({ lines: [line({ kind: 'text', text: token }), line({ kind: 'text', text: token })], code: 0 }) }); root = e.root;
  const dir = `${root}/arm`; await nodeFs.mkdirp(dir);
  const sequence: string[] = []; const events: unknown[] = [];
  const out = await runArm(e.p, e.agent, e.sandbox, { name: 'a-0', dir, tmpHome: `${root}/home`, task: 't', signal: new AbortController().signal,
    opts: { agent: 'claude', auth: 'subscription', runs: 'quick' }, scrub: makeScrub(), canaries: [{ path: '/fake', token }], cleanupPaths: [],
    onCanaryHit: () => sequence.push('hit'), onEvent: (_arm, event) => { sequence.push('event'); events.push(event); } });
  expect(sequence).toEqual(['hit', 'event', 'event']);
  expect(JSON.stringify({ events, out })).not.toContain(token);
  expect(out.metrics.canaryHits).toEqual(['[CANARY]']);
});
