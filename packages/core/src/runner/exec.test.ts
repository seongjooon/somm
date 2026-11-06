import { rm } from 'node:fs/promises';
import { afterEach, expect, test } from 'vitest';
import type { AgentEvent } from '../types';
import { invokeAgent, makeScrub } from './exec';
import { line, makeEnv, okLines, type Script } from './testkit.test';

let root = '';
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
async function run(script: Script, signal = new AbortController().signal, timeoutMs = 5000) {
  const e = await makeEnv({ script }); root = e.root;
  const seen: AgentEvent[] = [];
  const opts = { agent: 'claude', auth: 'subscription', runs: 'quick' } as const;
  const res = invokeAgent(e.p, e.agent, { cwd: e.root, tmpHome: `${e.root}/h`, prompt: 'p', opts, signal, timeoutMs, scrub: makeScrub(), onEvent: ev => seen.push(ev) });
  return { res, seen };
}
test('auth error event aborts the process and flags auth', async () => {
  const auth = line({ kind: 'error', error: { code: 'auth', message: 'Not logged in' } });
  const { res } = await run(async () => ({ lines: [auth], code: 1 }));
  expect(await res).toMatchObject({ auth: true, budget: false });
});
test('caller abort rethrows', async () => {
  const ctl = new AbortController();
  const { res } = await run(() => new Promise(() => { ctl.abort(); }), ctl.signal);
  await expect(res).rejects.toMatchObject({ name: 'AbortError' });
});
test('budget error sets the budget flag', async () => {
  const { res } = await run(async () => ({ lines: [line({ kind: 'error', error: { code: 'budget', message: 'over' } })], code: 1 }));
  expect(await res).toMatchObject({ budget: true, auth: false });
});
test('exit code and stderr are reported', async () => {
  const r = await (await run(async () => ({ lines: okLines(), code: 3, stderr: 'trace' }))).res;
  expect(r).toMatchObject({ code: 3, stderr: 'trace' });
});
test('timeout marks the invocation as timed out', async () => {
  const r = await (await run(() => new Promise(() => {}), undefined, 20)).res;
  expect(r.timedOut).toBe(true);
});
test('makeScrub removes the raw and JSON-escaped key from strings and events', () => {
  const key = 'k"ey\\1234567';
  const s = makeScrub(key);
  expect(s.str(`a ${key} b ${JSON.stringify(key).slice(1, -1)}`)).toBe('a [REDACTED] b [REDACTED]');
  const e: AgentEvent = { kind: 'text', text: key, raw: { k: key } };
  expect(JSON.stringify(s.event(e))).not.toContain('1234567');
  expect(makeScrub().str('x')).toBe('x');
});
