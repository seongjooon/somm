import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNodePlatform } from '@somm/core/node';
import type { AgentAdapter, Sandbox } from '@somm/core';
const deps = vi.hoisted(() => ({ agent: undefined as unknown, sandbox: undefined as unknown }));
vi.mock('@somm/core', async original => ({ ...await original<typeof import('@somm/core')>(), createAgents: () => ({ claude: deps.agent }), createLiteSandbox: () => deps.sandbox }));
import { run } from './test';
let root = '';
const old = process.env.SOMM_DATA_DIR;
afterEach(async () => { if (old === undefined) delete process.env.SOMM_DATA_DIR; else process.env.SOMM_DATA_DIR = old; if (root) await rm(root, { recursive: true, force: true }); });
it.each(['SIGINT', 'SIGTERM'] as const)('%s aborts the actual runner and cleans its sandbox', async signal => {
  root = await mkdtemp(join(tmpdir(), 'somm-signal-')); process.env.SOMM_DATA_DIR = join(root, 'data');
  await mkdir(join(root, 'skill')); await writeFile(join(root, 'skill', 'SKILL.md'), '# skill');
  const p = await createNodePlatform(); p.home = join(root, 'home');
  let aborted = false, cleaned = false;
  p.proc = { which: async names => Object.fromEntries(names.map(n => [n, null])), run: async (_bin, _args, options) => {
    process.emit(signal); aborted = options?.signal?.aborted === true; throw new DOMException('aborted', 'AbortError');
  } };
  const agent = { id: 'claude', detect: async () => ({ installed: true, loggedIn: true }), enumerateSkills: async () => [], skillDir: (_s: string, dir: string) => join(dir, '.claude/skills'), buildRun: () => ({ bin: 'fake', args: [], env: {}, cwd: root }), parseLine: () => null } as unknown as AgentAdapter;
  const sandbox = { prepare: async (_p: string, id: string) => { const base = join(root, id, 'base'); await mkdir(base, { recursive: true }); return { base, deps: { mode: 'none', ok: true, log: '' }, warnings: [] }; }, preparePreflight: async (_p: string, id: string) => { const base = join(root, id, 'base'); await mkdir(base, { recursive: true }); return { base, deps: { mode: 'none', ok: true, log: '' }, warnings: [] }; }, prepareDependencies: async () => ({ mode: 'none', ok: true, log: '' }), split: async (base: string, names: string[]) => { const dirs: Record<string, string> = {}; for (const n of names) { dirs[n] = join(base, '..', n); await mkdir(dirs[n], { recursive: true }); } return dirs; }, plantCanaries: async () => [], cleanup: async (id: string) => { cleaned = true; await rm(join(root, id), { recursive: true, force: true }); } } as unknown as Sandbox;
  deps.agent = agent; deps.sandbox = sandbox;
  const output: string[] = [];
  const code = await run([join(root, 'skill'), '--agent', 'claude', '--project', root, '--task', 'work', '--yes'], { platform: p, json: false, out: s => output.push(s), err: () => {}, confirm: async () => true });
  expect(code).toBe(1); expect(aborted).toBe(true); expect(cleaned).toBe(true); expect(output).toContain('Run cancelled');
});

it('SIGINT terminates the real sandbox installer child and removes its run', async () => {
  root = await mkdtemp(join(tmpdir(), 'somm-cli-installer-')); process.env.SOMM_DATA_DIR = join(root, 'data');
  const project = join(root, 'project'); await mkdir(project); await mkdir(join(root, 'home')); await mkdir(join(root, 'skill'));
  await writeFile(join(root, 'skill', 'SKILL.md'), '# skill'); await writeFile(join(project, 'pnpm-lock.yaml'), 'fixture');
  const p = await createNodePlatform(); p.home = join(root, 'home'); p.env = {};
  const original = p.proc; let pid = 0;
  p.proc = { which: async names => Object.fromEntries(names.map(n => [n, n === 'git' ? 'git' : n === 'pnpm' ? 'fake-installer' : null])), run: async (bin, args, options) => {
    if (bin === 'fake-installer') return original.run(process.execPath, ['-e', "process.stdout.write(String(process.pid)+'\\n'); setInterval(() => {}, 1000)"], { ...options, onLine: (_stream, line) => { pid = Number(line); process.emit('SIGINT'); } });
    return original.run(bin, args, { ...options, env: { ...options?.env, HOME: p.home } });
  } };
  deps.agent = { id: 'claude', detect: async () => ({ installed: true, loggedIn: true }), enumerateSkills: async () => [] } as unknown as AgentAdapter;
  const core = await vi.importActual<typeof import('@somm/core')>('@somm/core');
  deps.sandbox = core.createLiteSandbox(p, { git: 'git', pnpm: 'fake-installer' });
  const output: string[] = [];
  expect(await run([join(root, 'skill'), '--agent', 'claude', '--project', project, '--task', 'work', '--yes'], { platform: p, json: false, out: s => output.push(s), err: () => {}, confirm: async () => true })).toBe(1);
  expect(output).toContain('Run cancelled'); expect(pid).toBeGreaterThan(0); expect(() => process.kill(pid, 0)).toThrow();
  expect(await readdir(join(root, 'data/runs'))).toEqual([]);
});
