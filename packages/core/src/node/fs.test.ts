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
