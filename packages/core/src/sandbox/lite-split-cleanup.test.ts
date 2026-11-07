import { expect, test } from 'vitest';
import { nodeFs as fs } from '../node/fs';
import type { Proc } from '../platform';
import { createLiteSandbox } from './lite';
import { root, project, p, bins, git, fixture } from './lite-test-helpers';
test('clones root and workspace dependencies, splits independent copies, and collects full diff', async () => {
  await fixture({ 'pnpm-lock.yaml': 'fixture lock' });
  for (const dir of ['node_modules/x', 'packages/a/node_modules/x']) {
    await fs.mkdirp(`${project}/${dir}`); await fs.writeText(`${project}/${dir}/index.js`, 'original');
  }
  const sandbox = createLiteSandbox(p, bins);
  const { base, deps } = await sandbox.prepare(project, 'clone'); expect(deps.mode).toBe('cloned');
  expect(await fs.readText(`${base}/packages/a/node_modules/x/index.js`)).toBe('original');
  expect(await git(['status', '--porcelain'], base)).toBe('');
  const arms = await sandbox.split(base, ['a-0', 'b-0']);
  await fs.writeText(`${arms['a-0']}/main.txt`, 'new\nextra\nkeep\n');
  await fs.writeText(`${arms['a-0']}/node_modules/x/index.js`, 'changed');
  expect(await fs.readText(`${arms['b-0']}/main.txt`)).toBe('old\nkeep\n');
  expect(await fs.readText(`${project}/node_modules/x/index.js`)).toBe('original');
  expect(await sandbox.diffStat(arms['a-0'])).toMatchObject({ files: 1, added: 2, removed: 1 });
  await fs.writeText(`${arms['a-0']}/new.txt`, 'fresh\n');
  expect(await sandbox.diffStat(arms['a-0'])).toMatchObject({ files: 2, added: 3, removed: 1 });
});
test('rejects traversal, duplicate runs, arm collisions, and canary symlink escapes', async () => {
  await fixture(); const sandbox = createLiteSandbox(p, bins);
  await expect(sandbox.prepare(project, '../escape')).rejects.toThrow('identifier');
  const { base } = await sandbox.prepare(project, 'safe');
  await expect(sandbox.prepare(project, 'safe')).rejects.toThrow('already exists');
  await expect(sandbox.split(base, ['base'])).rejects.toThrow('arms');
  await expect(sandbox.split(base, ['../escape'])).rejects.toThrow('identifier');
  await fs.symlink(project, `${base}/config`);
  await expect(sandbox.plantCanaries({ projectDir: base })).rejects.toThrow('symlink');
  expect(await fs.exists(`${project}/secrets.local.json`)).toBe(false);
});
test('falls back to regular copies and exposes the warning even when splitting', async () => {
  await fixture();
  const proc: Proc = { ...p.proc, async run(bin, args, opts) {
    if (bin === 'cp' && args[0] === '-cR') return { code: 1, stdout: '', stderr: 'clone unsupported' };
    return p.proc.run(bin, args, opts);
  } };
  const sandbox = createLiteSandbox({ ...p, proc }, bins);
  const { base, warnings } = await sandbox.prepare(project, 'fallback');
  expect(warnings).not.toContain('slow-copy');
  const arms = await sandbox.split(base, ['a']);
  expect(warnings).toContain('slow-copy');
  expect(await fs.readText(`${arms.a}/main.txt`)).toBe('old\nkeep\n');
});
