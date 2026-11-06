import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodePlatform } from '@somm/core/node';
import type { CliContext } from '../output';
import * as install from './install';
import * as test from './test';

let root: string, ctx: CliContext, lines: string[];
const previous = process.env.SOMM_DATA_DIR;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'somm-run-'));
  process.env.SOMM_DATA_DIR = join(root, 'data');
  const platform = await createNodePlatform(); platform.home = join(root, 'home');
  platform.proc = { which: async names => Object.fromEntries(names.map(n => [n, null])), run: async () => { throw new Error('unexpected process'); } };
  lines = []; ctx = { platform, json: false, out: l => lines.push(l), err: l => lines.push(l), confirm: async () => true };
  await mkdir(join(root, 'skill')); await writeFile(join(root, 'skill', 'SKILL.md'), '# skill');
});
afterEach(async () => { if (previous === undefined) delete process.env.SOMM_DATA_DIR; else process.env.SOMM_DATA_DIR = previous; await rm(root, { recursive: true, force: true }); });
it('refuses to overwrite an installed skill without force', async () => {
  const args = [join(root, 'skill'), '--agent', 'claude', '--scope', 'global'];
  expect(await install.run(args, ctx)).toBe(0);
  expect(await install.run(args, ctx)).toBe(1);
});
it('reports missing login and the subscription warning', async () => {
  expect(await test.run([join(root, 'skill'), '--project', root, '--agent', 'claude', '--task', 'test', '--runs', 'thorough', '--yes'], ctx)).toBe(1);
  expect(lines.join('\n')).toContain('This uses 6 runs of your subscription quota. Subscription limits assume individual use.');
  expect(lines.join('\n')).toMatch(/log in/i);
});
it('blocks a skill with a recorded F grade', async () => {
  await ctx.platform.db.execute('INSERT INTO runs (id, skill_id, result_json, finished_at) VALUES (?, ?, ?, ?)', ['bad', 'skill', JSON.stringify({ grade: 'F' }), '2026-01-01']);
  expect(await install.run([join(root, 'skill'), '--agent', 'claude', '--scope', 'global'], ctx)).toBe(2);
  expect(lines[0]).toBe('// somm: corked');
});
it('requires an isolated API key without printing its value', async () => {
  const old = process.env.CODEX_API_KEY; delete process.env.CODEX_API_KEY;
  try { expect(await test.run([join(root, 'skill'), '--project', root, '--agent', 'codex', '--auth', 'isolated', '--task', 'test', '--yes'], ctx)).toBe(1); expect(lines.join('\n')).toContain('CODEX_API_KEY'); }
  finally { if (old !== undefined) process.env.CODEX_API_KEY = old; }
});
