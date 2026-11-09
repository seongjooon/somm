import { afterEach, beforeEach, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeFs as fs } from '../node/fs';
import { nodeProc } from '../node/proc';
import type { Platform } from '../platform';
import { SANDBOX_GIT_ENV } from './lite';
export let root: string, project: string, p: Platform;
export function setProject(value: string) { project = value; }
export const bins = { git: 'git', pnpm: 'pnpm' };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'somm-sandbox-'));
  project = `${root}/공백 한글 프로젝트`;
  await fs.mkdirp(project);
  await fs.mkdirp(`${root}/empty-home`);
  p = { fs, proc: { ...nodeProc, run: (bin, args, opts) => nodeProc.run(bin, args,
    { ...opts, env: { HOME: `${root}/empty-home`, GIT_CONFIG_NOSYSTEM: '1', ...opts?.env } }) },
  home: `${root}/empty-home`, dataDir: `${root}/data`, env: {},
  db: { async select() { return []; }, async execute() {} } };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
export async function git(args: string[], cwd = project) {
  const result = await p.proc.run('git', args, { cwd, env: SANDBOX_GIT_ENV });
  expect(result.code, result.stderr).toBe(0);
  return result.stdout.trim();
}
export async function fixture(extra: Record<string, string> = {}) {
  await fs.writeText(`${project}/main.txt`, 'old\nkeep\n');
  for (const [file, contents] of Object.entries(extra)) await fs.writeText(`${project}/${file}`, contents);
  await git(['init', '-q']); await git(['add', '-A']); await git(['commit', '-qm', 'fixture']);
}

export async function evilScript(marker: string) {
  const script = `${root}/evil2.sh`;
  await fs.writeText(script, `#!/bin/sh\ntouch '${marker}'\ncat\n`);
  expect((await p.proc.run('chmod', ['+x', script])).code).toBe(0);
  return script;
}
