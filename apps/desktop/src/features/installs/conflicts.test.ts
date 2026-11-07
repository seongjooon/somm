import { expect, test } from 'vitest';
import type { InstalledSkill, Platform } from '@somm/core';
import { inspectConflicts } from './conflicts';

test('keeps unreadable symlinks visible while detecting conflicts among readable skills', async () => {
  const item = (name: string): InstalledSkill => ({ name, agent: 'claude', scope: 'global', dir: `/${name}`, enabled: true, hash: name === 'broken' ? '' : 'hash', managedBySomm: false, isSymlink: name === 'broken' });
  const items = [item('broken'), item('one'), item('two')];
  const p = { fs: {
    async readDir(path: string) { if (path === '/broken') throw new Error('missing target'); return [{ name: 'SKILL.md', isDir: false, isSymlink: false }, { name: 'commands', isDir: true, isSymlink: false }]; },
    async readBytes() { return new TextEncoder().encode('test'); },
  } } as unknown as Platform;
  p.fs.readDir = async path => { if (path === '/broken') throw new Error('missing target'); return path.endsWith('/commands') ? [{ name: 'review.md', isDir: false, isSymlink: false }] : [{ name: 'SKILL.md', isDir: false, isSymlink: false }, { name: 'commands', isDir: true, isSymlink: false }]; };
  const result = await inspectConflicts(p, items);
  expect(result.unreadable).toEqual(['/broken']);
  expect(result.conflicts['/one'].some(conflict => conflict.with === 'two')).toBe(true);
});

test('real service lists and removes broken and unreadable active skills', async () => {
  const { mkdtemp, mkdir, writeFile, symlink, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { DatabaseSync } = await import('node:sqlite');
  const { nodeFs } = await import('../../../../../packages/core/src/node/fs');
  const { nodeProc } = await import('../../../../../packages/core/src/node/proc');
  const { migrate } = await import('@somm/core');
  const { realService } = await import('./service');
  const home = await mkdtemp(`${tmpdir()}/somm 한글 space-`);
  const db = new DatabaseSync(':memory:');
  try {
    const root = `${home}/.claude/skills`;
    await mkdir(`${root}/empty`, { recursive: true });
    await mkdir(`${root}/unreadable`, { recursive: true });
    await writeFile(`${root}/unreadable/SKILL.md`, 'content');
    await symlink(`${home}/missing`, `${root}/broken`);
    const p: Platform = { home, dataDir: `${home}/data`, env: {}, proc: nodeProc,
      fs: { ...nodeFs, async readBytes(path) { if (path.includes('/unreadable/')) throw new Error('permission denied'); return nodeFs.readBytes(path); } },
      db: { async select<T>(sql: string, args: unknown[] = []) { return db.prepare(sql).all(...args as never[]) as T[]; }, async execute(sql, args = []) { db.prepare(sql).run(...args as never[]); } },
    };
    await migrate(p.db);
    const service = realService(p);
    const items = await service.list();
    expect(items.map(item => item.name).sort()).toEqual(['broken', 'empty', 'unreadable']);
    expect(items.every(item => item.hash === '')).toBe(true);
    const inspection = await service.conflicts(items);
    expect(inspection.unreadable.sort()).toEqual(items.map(item => item.dir).sort());
    for (const item of items) await service.uninstall(item);
    expect(await service.list()).toEqual([]);
  } finally { db.close(); await rm(home, { recursive: true, force: true }); }
});
