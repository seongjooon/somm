import { expect, test } from 'vitest';
import { stat, utimes } from 'node:fs/promises';
import { nodeFs as fs } from '../node/fs';
import { createLiteSandbox } from './lite';
import { root, project, p, bins, git, fixture } from './lite-test-helpers';
async function evilScript(marker: string) {
  const script = `${root}/evil2.sh`;
  await fs.writeText(script, `#!/bin/sh\ntouch '${marker}'\ncat\n`);
  expect((await p.proc.run('chmod', ['+x', script])).code).toBe(0);
  return script;
}
test('baseline includes archived files even when source gitignore would normally hide them', async () => {
  await fixture({ '.gitignore': 'main.txt\n' });
  // fixture() uses a normal add; force-add the intentionally ignored source file.
  await git(['add', '-f', 'main.txt']); await git(['commit', '-qm', 'force tracked source']);
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'ignored');
  const arms = await sandbox.split(base, ['a']);
  await fs.writeText(`${arms.a}/main.txt`, 'changed\n');
  expect(await sandbox.diffStat(arms.a)).toMatchObject({ files: 1, added: 1, removed: 2 });
});
test('agent-controlled arm git config and attributes never execute during diffStat', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'gitcfg');
  const arms = await sandbox.split(base, ['a']);
  const marker = `${root}/pwned`, script = `${root}/evil.sh`;
  await fs.writeText(script, `#!/bin/sh\ntouch '${marker}'\ncat\n`);
  expect((await p.proc.run('chmod', ['+x', script])).code).toBe(0);
  await fs.writeText(`${arms.a}/.git/config`, `[core]\n\tfsmonitor = ${script}\n[filter "x"]\n\tclean = ${script}\n[diff "x"]\n\ttextconv = ${script}\n`);
  await fs.writeText(`${arms.a}/.gitattributes`, '* filter=x diff=x\n');
  await fs.writeText(`${arms.a}/.git/info/attributes`, '* filter=x diff=x\n');
  await fs.writeText(`${arms.a}/main.txt`, 'changed\n');
  await sandbox.diffStat(arms.a);
  expect(await fs.exists(marker)).toBe(false);
});
test('prepare never writes to the source repository index', async () => {
  await fixture();
  const future = new Date(Date.now() + 60_000);
  await utimes(`${project}/main.txt`, future, future);
  const before = (await stat(`${project}/.git/index`)).mtimeMs;
  await createLiteSandbox(p, bins).prepare(project, 'locks');
  expect((await stat(`${project}/.git/index`)).mtimeMs).toBe(before);
});
test('rejects absolute dependency links into the home directory', async () => {
  await fixture(); await fs.mkdirp(`${project}/.venv/bin`);
  await fs.symlink(`${p.home}/x`, `${project}/.venv/bin/python`);
  const { deps } = await createLiteSandbox(p, bins).prepare(project, 'venv-home');
  expect(deps.ok).toBe(false);
});
test('arm git config fsmonitor and attribute filters leave no marker files', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'hard1');
  const arms = await sandbox.split(base, ['a']);
  const marker = `${root}/marker1`, script = await evilScript(marker);
  await fs.writeText(`${arms.a}/.git/config`, `[core]\n\tfsmonitor = ${script}\n[filter "x"]\n\tclean = ${script}\n`);
  await fs.writeText(`${arms.a}/.gitattributes`, '* filter=x\n');
  await fs.writeText(`${arms.a}/main.txt`, 'changed\n');
  await sandbox.diffStat(arms.a);
  expect(await fs.exists(marker)).toBe(false);
});
test('arm commondir and alternates do not change the diff or reach outside', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'hard2');
  const arms = await sandbox.split(base, ['a']);
  await fs.writeText(`${arms.a}/main.txt`, 'changed\n');
  const expected = await sandbox.diffStat(arms.a);
  await fs.writeText(`${arms.a}/.git/commondir`, `${project}/.git\n`);
  await fs.mkdirp(`${arms.a}/.git/objects/info`);
  await fs.writeText(`${arms.a}/.git/objects/info/alternates`, `${project}/.git/objects\n`);
  const before = (await stat(`${project}/.git/index`)).mtimeMs;
  expect(await sandbox.diffStat(arms.a)).toEqual(expected);
  expect((await stat(`${project}/.git/index`)).mtimeMs).toBe(before);
});
test('concurrent diffStat calls on one arm succeed', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'conc');
  const arms = await sandbox.split(base, ['a']);
  await fs.writeText(`${arms.a}/main.txt`, 'changed\n');
  const [x, y] = await Promise.all([sandbox.diffStat(arms.a), sandbox.diffStat(arms.a)]);
  expect(x).toMatchObject({ files: 1 }); expect(y).toEqual(x);
});

// Accepted limitation: an arm .gitignore can hide its own changes from the diff (ignored files are not force-added).
test('a poisoned base git config and attributes never execute during diffStat', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'poison');
  const arms = await sandbox.split(base, ['a']);
  const marker = `${root}/marker-base`, script = await evilScript(marker);
  await fs.writeText(`${base}/.git/config`, `[core]\n\tfsmonitor = ${script}\n[filter "x"]\n\tclean = ${script}\n`);
  await fs.writeText(`${base}/.git/info/attributes`, '* filter=x\n');
  await fs.writeText(`${arms.a}/main.txt`, 'changed\n');
  await sandbox.diffStat(arms.a);
  expect(await fs.exists(marker)).toBe(false);
});

test('user-level git config filters are not applied during diffStat', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'hard3');
  const arms = await sandbox.split(base, ['a']);
  const marker = `${root}/marker3`, script = await evilScript(marker);
  await fs.writeText(`${root}/empty-home/.gitconfig`, `[filter "x"]\n\tclean = ${script}\n`);
  await fs.writeText(`${arms.a}/.gitattributes`, '* filter=x\n');
  await fs.writeText(`${arms.a}/main.txt`, 'changed\n');
  await sandbox.diffStat(arms.a);
  expect(await fs.exists(marker)).toBe(false);
});

