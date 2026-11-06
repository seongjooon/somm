import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgents } from '../agents';
import { nodeFs } from '../node/fs';
import { nodeProc } from '../node/proc';
import { createLiteSandbox } from '../sandbox';
import type { Platform } from '../platform';
import { runAB } from './run';
import { proposeTasks } from './propose';

let root: string, project: string, p: Platform, marker: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'somm-preflight-')); project = join(root, 'project'); marker = join(root, 'installed');
  await mkdir(project); await mkdir(join(root, 'home'));
  await writeFile(join(project, 'pnpm-lock.yaml'), 'fixture');
  await writeFile(join(project, 'package.json'), '{"scripts":{"postinstall":"write-marker"}}');
  p = { fs: nodeFs, home: join(root, 'home'), dataDir: join(root, 'data'), env: {}, db: { select: async () => [], execute: async () => {} }, proc: { ...nodeProc, async run(bin, args, opts) {
    if (bin === 'fake-installer') { await writeFile(marker, 'called'); return { code: 0, stdout: '', stderr: '' }; }
    if (bin === 'claude' || bin === 'codex') throw new Error('Unexpected real agent call');
    return nodeProc.run(bin, args, { ...opts, env: { ...opts?.env, HOME: join(root, 'home') } });
  } } };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
test.each(['run', 'proposal'] as const)('%s rejects residue before installing or checking authentication', async mode => {
  const skill = join(project, '.claude/skills/tdd'); await mkdir(skill, { recursive: true }); await writeFile(join(skill, 'SKILL.md'), '# skill');
  const agent = createAgents(p).claude; let detects = 0; agent.detect = async () => { detects++; return { installed: true, loggedIn: true }; };
  const sandbox = createLiteSandbox(p, { git: 'git', pnpm: 'fake-installer' });
  const signal = new AbortController().signal;
  if (mode === 'run') {
    const result = await runAB(p, { agent, sandbox }, { runId: 'blocked', skill: { name: 'tdd', files: [{ path: 'SKILL.md', contents: '# skill' }] }, staticGrade: 'A', projectDir: project, task: 'work', opts: { agent: 'claude', auth: 'subscription', runs: 'quick' }, signal, onEvent: () => {} });
    expect(result.warnings).toContain('target-in-residue');
  } else {
    await expect(proposeTasks(p, { agent, sandbox }, { runId: 'blocked', skill: { name: 'tdd', description: '' }, projectDir: project, opts: { agent: 'claude', auth: 'subscription', runs: 'quick' }, signal })).rejects.toMatchObject({ name: 'TargetInResidueError' });
  }
  expect(detects).toBe(0); expect(await nodeFs.exists(marker)).toBe(false); expect(await nodeFs.exists(join(root, 'data/runs/blocked'))).toBe(false);
  expect(await readFile(join(skill, 'SKILL.md'), 'utf8')).toBe('# skill');
});
test.each(['run', 'proposal'] as const)('%s rejects failed authentication before installing dependencies', async mode => {
  const agent = createAgents(p).claude; let detects = 0; agent.detect = async () => { detects++; return { installed: true, loggedIn: false }; };
  const sandbox = createLiteSandbox(p, { git: 'git', pnpm: 'fake-installer' }); const signal = new AbortController().signal;
  if (mode === 'run') {
    const result = await runAB(p, { agent, sandbox }, { runId: 'auth', skill: { name: 'tdd', files: [{ path: 'SKILL.md', contents: '# skill' }] }, staticGrade: 'A', projectDir: project, task: 'work', opts: { agent: 'claude', auth: 'subscription', runs: 'quick' }, signal, onEvent: () => {} });
    expect(result.warnings).toContain('auth');
  } else {
    await expect(proposeTasks(p, { agent, sandbox }, { runId: 'auth', skill: { name: 'tdd', description: '' }, projectDir: project, opts: { agent: 'claude', auth: 'subscription', runs: 'quick' }, signal })).rejects.toThrow('not logged in');
  }
  expect(detects).toBe(1); expect(await nodeFs.exists(marker)).toBe(false); expect(await nodeFs.exists(join(root, 'data/runs/auth'))).toBe(false);
  expect(await readFile(join(project, 'pnpm-lock.yaml'), 'utf8')).toBe('fixture');
});
test('prepares dependencies after successful authentication before the proposal', async () => {
  const agent = createAgents(p).claude; const order: string[] = [];
  agent.detect = async () => { order.push('detect'); return { installed: true, loggedIn: true }; };
  agent.buildRun = request => ({ bin: 'fake-agent', args: [], cwd: request.cwd, env: {} });
  agent.parseLine = line => ({ kind: 'text', text: line, raw: {} });
  const original = p.proc.run;
  p.proc.run = async (bin, args, opts) => {
    if (bin === 'fake-installer') order.push('install');
    if (bin === 'fake-agent') { order.push('agent'); opts?.onLine?.('stdout', '["one","two","three"]'); return { code: 0, stdout: '', stderr: '' }; }
    return original(bin, args, opts);
  };
  const sandbox = createLiteSandbox(p, { git: 'git', pnpm: 'fake-installer' });
  expect(await proposeTasks(p, { agent, sandbox }, { runId: 'ok', projectDir: project, skill: { name: 'tdd', description: '' }, opts: { agent: 'claude', auth: 'subscription', runs: 'quick' }, signal: new AbortController().signal })).toEqual(['one', 'two', 'three']);
  expect(order).toEqual(['detect', 'install', 'agent']); expect(await nodeFs.exists(marker)).toBe(true); expect(await nodeFs.exists(join(root, 'data/runs/ok'))).toBe(false);
});
