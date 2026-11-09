import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({ enabled: false }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: async (...args: Parameters<typeof actual.open>) => {
    const path = String(args[0]);
    if (state.enabled && path.endsWith('/config/secrets.local.json')) {
      const env = path.replace('/config/secrets.local.json', '/.env');
      await actual.rename(env, `${env}.old`); await actual.writeFile(env, 'agent replacement');
      throw Object.assign(new Error('collision'), { code: 'EEXIST' });
    }
    return actual.open(...args);
  } };
});
import { nodeCanaries } from './canaries';
test('partial-create rollback retains a replaced file and reports it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'somm-canary-rollback-'));
  try {
    const arm = join(root, 'runs/run/a-0'); await mkdir(arm, { recursive: true });
    state.enabled = true;
    await expect(nodeCanaries(root, 'run', 'a-0', false)).rejects.toThrow('Canary creation and cleanup failed');
    expect(await readFile(join(arm, '.env'), 'utf8')).toBe('agent replacement');
  } finally { state.enabled = false; await rm(root, { recursive: true, force: true }); }
});
