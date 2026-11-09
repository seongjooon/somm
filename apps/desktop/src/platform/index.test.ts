import { expect, test, vi } from 'vitest';
const bridge = vi.hoisted(() => ({ readFile: vi.fn(), writeFile: vi.fn(), lstat: vi.fn(), rename: vi.fn(), exists: vi.fn(async () => false) }));
vi.mock('@tauri-apps/plugin-fs', () => bridge);
const invokeMock = vi.hoisted(() => vi.fn(async (command: string, _args?: unknown): Promise<unknown> => command === 'readlink' ? '/tmp/data/target' : { home: '/tmp/home', dataDir: '/tmp/data', env: { PATH: '/custom/bin', SOMM_DATA_DIR: '/tmp/data' } }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => ({ execute: async () => {}, select: async () => [{ user_version: 1 }] }) } }));
import { createTauriPlatform } from './index';
test('git config commands use only the validated run id and release snapshots', async () => {
  const p = await createTauriPlatform();
  const snapshot = await p.fs.snapshotSandboxGitConfig('/tmp/data', '/tmp/data/runs/run-1/base', 'run-1');
  expect(invokeMock).toHaveBeenLastCalledWith('sandbox_git_snapshot', { runId: 'run-1' });
  await snapshot.restore(); expect(invokeMock).toHaveBeenLastCalledWith('sandbox_git_restore', { runId: 'run-1' });
  await snapshot.dispose(); expect(invokeMock).toHaveBeenLastCalledWith('sandbox_git_forget', { runId: 'run-1' });
  await expect(p.fs.snapshotSandboxGitConfig('/tmp/data', '/outside/base', '../other')).rejects.toThrow('Invalid sandbox base');
});
test('exposes filtered environment and treats dangling links as existing', async () => {
  const platform = await createTauriPlatform();
  expect(platform.env.PATH).toBe('/custom/bin');
  bridge.lstat.mockResolvedValueOnce({ isSymlink: true });
  expect(await platform.fs.exists('/tmp/data/dangling')).toBe(true);
  bridge.lstat.mockRejectedValueOnce('failed to get metadata of path: /tmp/data/missing with error: No such file or directory (os error 2)');
  expect(await platform.fs.exists('/tmp/data/missing')).toBe(false);
});
test('checks symlinks using lstat and propagates errors', async () => {
  const p = await createTauriPlatform();
  bridge.lstat.mockResolvedValueOnce({ isSymlink: true }).mockResolvedValueOnce({ isSymlink: false });
  expect(await p.fs.isSymlink('/tmp/data/link')).toBe(true);
  expect(await p.fs.isSymlink('/tmp/data/dir')).toBe(false);
  bridge.lstat.mockRejectedValueOnce('denied');
  await expect(p.fs.isSymlink('/tmp/data/denied')).rejects.toBe('denied');
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

test('fileSize returns lstat size and propagates errors', async () => {
  const p = await createTauriPlatform();
  bridge.lstat.mockResolvedValueOnce({ size: 123 });
  expect(await p.fs.fileSize('/tmp/data/asset')).toBe(123);
  expect(bridge.lstat).toHaveBeenLastCalledWith('/tmp/data/asset');
  const error = new Error('denied');
  bridge.lstat.mockRejectedValueOnce(error);
  await expect(p.fs.fileSize('/outside')).rejects.toBe(error);
});
test('canary commands use identifiers and propagate failures', async () => {
  const p = await createTauriPlatform();
  invokeMock.mockResolvedValueOnce([{ path: '/tmp/data/runs/r/a-0/.env', token: 'test' }]);
  expect(await p.fs.createCanaries('/tmp/data', 'r', 'a-0', true)).toHaveLength(1);
  expect(invokeMock).toHaveBeenLastCalledWith('sandbox_canaries_create', { runId: 'r', arm: 'a-0', includeHome: true });
  invokeMock.mockRejectedValueOnce('Canary collision');
  await expect(p.fs.createCanaries('/tmp/data', 'r', 'a-0', false)).rejects.toBe('Canary collision');
  await p.fs.removeCanaries('/tmp/data', 'r', 'a-0', []);
  expect(invokeMock).toHaveBeenLastCalledWith('sandbox_canaries_remove', { runId: 'r', arm: 'a-0', canaries: [] });
  invokeMock.mockRejectedValueOnce('cleanup failed');
  await expect(p.fs.removeCanaries('/tmp/data', 'r', 'a-0', [])).rejects.toBe('cleanup failed');
});
