import { expect, test } from 'vitest';
import type { InstalledSkill, Platform } from '@somm/core';
import { inspectConflicts } from './conflicts';

test('keeps unreadable symlinks visible while detecting conflicts among readable skills', async () => {
  const item = (name: string): InstalledSkill => ({ name, agent: 'claude', scope: 'global', dir: `/${name}`, enabled: true, hash: '', managedBySomm: false, isSymlink: name === 'broken' });
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
