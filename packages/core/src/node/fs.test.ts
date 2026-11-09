import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeFs as fs } from './fs';
test('supports every filesystem operation with spaces and Korean', async () => {
  const root = await mkdtemp(join(tmpdir(), '공백 한글 dir'));
  try {
    await fs.mkdirp(`${root}/nested/deep`);
    await fs.writeText(`${root}/nested/file`, '한글');
    expect(await fs.readText(`${root}/nested/file`)).toBe('한글');
    await fs.rename(`${root}/nested/file`, `${root}/renamed`);
    await fs.symlink(`${root}/renamed`, `${root}/link`);
    expect(await fs.readDir(root)).toEqual(expect.arrayContaining([
      { name: 'nested', isDir: true, isSymlink: false }, { name: 'link', isDir: false, isSymlink: true },
    ]));
    expect(await fs.exists(`${root}/link`)).toBe(true);
    await fs.remove(`${root}/nested`);
    expect(await fs.exists(`${root}/nested`)).toBe(false);
    await fs.remove(`${root}/missing`);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('readlink returns direct relative target without following the chain', async () => {
  const root = await mkdtemp(join(tmpdir(), 'somm-realpath-'));
  try {
    await fs.writeText(`${root}/target`, 'content');
    await fs.symlink('target', `${root}/relative`);
    expect(await fs.readlink(`${root}/relative`)).toBe('target');
    await expect(fs.readlink(`${root}/missing`)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('sandbox config snapshot rejects a non-regular config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'somm-config-'));
  try {
    const base = `${root}/runs/a/base`;
    await fs.mkdirp(`${base}/.git/config`);
    await expect(fs.snapshotSandboxGitConfig(root, base, 'a')).rejects.toThrow('not a regular file');
  } finally { await rm(root, { recursive: true, force: true }); }
});
