import { expect, test, vi } from 'vitest';
const bridge = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn(), lstat: vi.fn(), rename: vi.fn(), exists: vi.fn(async () => false) }));
vi.mock('@tauri-apps/plugin-fs', () => bridge);
const invokeMock = vi.hoisted(() => vi.fn(async (command: string, _args?: unknown): Promise<unknown> => command === 'readlink' ? '/tmp/data/target' : { home: '/tmp/home', dataDir: '/tmp/data', env: { PATH: '/custom/bin', SOMM_DATA_DIR: '/tmp/data' } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => ({ execute: async () => {}, select: async () => [{ user_version: 1 }] }) } }));
import { createTauriPlatform } from './index';
test('exposes filtered environment and treats dangling links as existing', async () => {
  const platform = await createTauriPlatform();
  expect(platform.env.PATH).toBe('/custom/bin');
  bridge.lstat.mockResolvedValueOnce({ isSymlink: true });
  expect(await platform.fs.exists('/tmp/data/dangling')).toBe(true);
  bridge.lstat.mockRejectedValueOnce('failed to get metadata of path: /tmp/data/missing with error: No such file or directory (os error 2)');
  expect(await platform.fs.exists('/tmp/data/missing')).toBe(false);
});
test('readlink delegates to the scoped native command and propagates denials', async () => {
  const p = await createTauriPlatform();
  expect(await p.fs.readlink('/tmp/data/link')).toBe('/tmp/data/target');
  expect(invokeMock).toHaveBeenLastCalledWith('readlink', { path: '/tmp/data/link' });
  invokeMock.mockRejectedValueOnce('Resolved path outside filesystem scope');
  await expect(p.fs.readlink('/tmp/data/link')).rejects.toBe('Resolved path outside filesystem scope');
});
test('normalizes only confirmed plugin-fs cross-device rename strings', async () => {
  const p = await createTauriPlatform();
  for (const text of ['Cross-device link', 'Invalid cross-device link']) {
    bridge.rename.mockRejectedValueOnce(`failed to rename old path: /old to new path: /new with error: ${text} (os error 18)`);
    await expect(p.fs.rename('/old', '/new')).rejects.toMatchObject({ code: 'EXDEV' });
  }
  for (const error of ['Path outside filesystem scope', 'failed to rename old path: /old to new path: /new with error: Permission denied (os error 13)', new Error('other failure')]) {
    bridge.rename.mockRejectedValueOnce(error);
    await expect(p.fs.rename('/old', '/new')).rejects.toBe(error);
  }
});

test('propagates filesystem errors from exists and remove', async () => {
  const p = await createTauriPlatform();
  for (const error of ['Path outside filesystem scope', 'failed to get metadata of path: /x with error: Permission denied (os error 13)']) {
    bridge.lstat.mockRejectedValueOnce(error);
    await expect(p.fs.exists('/x')).rejects.toBe(error);
    bridge.lstat.mockRejectedValueOnce(error);
    await expect(p.fs.remove('/x')).rejects.toBe(error);
  }
});

test('byte adapter preserves binary buffers and propagates read/write denial', async () => {
  const p = await createTauriPlatform();
  const bytes = new Uint8Array([0, 255, 128, 13, 10]);
  bridge.readFile.mockResolvedValueOnce(bytes);
  expect(await p.fs.readBytes('/tmp/data/asset')).toEqual(bytes);
  await p.fs.writeBytes('/tmp/data/asset', bytes);
  expect(bridge.writeFile).toHaveBeenLastCalledWith('/tmp/data/asset', bytes);
  bridge.readFile.mockRejectedValueOnce('denied');
  await expect(p.fs.readBytes('/outside')).rejects.toBe('denied');
  bridge.writeFile.mockRejectedValueOnce('denied');
  await expect(p.fs.writeBytes('/outside', bytes)).rejects.toBe('denied');
});
