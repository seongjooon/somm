import { expect, test, vi } from 'vitest';
const bridge = vi.hoisted(() => ({ lstat: vi.fn(), exists: vi.fn(async () => false) }));
vi.mock('@tauri-apps/plugin-fs', () => bridge);
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => ({ home: '/tmp/home', dataDir: '/tmp/data', env: { PATH: '/custom/bin', SOMM_DATA_DIR: '/tmp/data' } }) }));
vi.mock('@tauri-apps/plugin-sql', () => ({ default: { load: async () => ({ execute: async () => {}, select: async () => [{ user_version: 1 }] }) } }));
import { createTauriPlatform } from './index';
test('exposes filtered environment and treats dangling links as existing', async () => {
  const platform = await createTauriPlatform();
  expect(platform.env.PATH).toBe('/custom/bin');
  bridge.lstat.mockResolvedValueOnce({ isSymlink: true });
  expect(await platform.fs.exists('/tmp/data/dangling')).toBe(true);
  bridge.lstat.mockRejectedValueOnce(new Error('not found'));
  expect(await platform.fs.exists('/tmp/data/missing')).toBe(false);
});
