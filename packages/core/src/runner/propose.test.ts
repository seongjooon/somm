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
