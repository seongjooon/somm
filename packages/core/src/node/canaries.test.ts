import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { nodeCanaries, removeNodeCanaries } from './canaries';

test('preserves and reports replaced and missing files while removing untouched canaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'somm-canary-cleanup-'));
  try {
    const arm = join(root, 'runs', 'run', 'a-0'); await mkdir(arm, { recursive: true });
    const canaries = await nodeCanaries(root, 'run', 'a-0', false);
    await rename(join(arm, '.env'), join(arm, 'old-env'));
    await writeFile(join(arm, '.env'), 'agent file');
    expect(await removeNodeCanaries(root, 'run', 'a-0', canaries)).toEqual(['a-0/.env']);
    expect(await readFile(join(arm, '.env'), 'utf8')).toBe('agent file');
    expect(await removeNodeCanaries(root, 'run', 'a-0', canaries)).toEqual(['a-0/.env', 'a-0/config/secrets.local.json']);
    expect(await removeNodeCanaries(root, 'run', 'a-0', [])).toEqual([]);
    expect(await readFile(join(arm, '.env'), 'utf8')).toBe('agent file');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('rollback cleanup preserves replacement', async () => {
  const root = await mkdtemp(join(tmpdir(), 'somm-canary-rollback-'));
  try {
    const arm = join(root, 'runs', 'run', 'a-0'); await mkdir(arm, { recursive: true });
    const canaries = await nodeCanaries(root, 'run', 'a-0', false);
    await rename(join(arm, '.env'), join(arm, 'old-env')); await writeFile(join(arm, '.env'), 'replacement');
    expect(await removeNodeCanaries(root, 'run', 'a-0', canaries)).toEqual(['a-0/.env']);
    expect(await readFile(join(arm, '.env'), 'utf8')).toBe('replacement');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('preserves canary when its contents change in place', async () => {
  const root = await mkdtemp(join(tmpdir(), 'somm-canary-modified-'));
  try {
    const arm = join(root, 'runs/run/a-0'); await mkdir(arm, { recursive: true });
    const canaries = await nodeCanaries(root, 'run', 'a-0', false);
    await writeFile(join(arm, '.env'), 'edited');
    expect(await removeNodeCanaries(root, 'run', 'a-0', canaries)).toEqual(['a-0/.env']);
    expect(await readFile(join(arm, '.env'), 'utf8')).toBe('edited');
  } finally { await rm(root, { recursive: true, force: true }); }
});
