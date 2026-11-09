import { expect, test } from 'vitest';
import type { InstalledSkill, Platform } from '@somm/core';
import { hasIncompleteConflicts, inspectConflicts } from './conflicts';

test('keeps unreadable symlinks visible while detecting conflicts among readable skills', async () => {
  const item = (name: string): InstalledSkill => ({ name, agent: 'claude', scope: 'global', dir: `/${name}`, enabled: true, hash: name === 'broken' ? '' : 'hash', managedBySomm: false, isSymlink: name === 'broken' });
  const items = [item('broken'), item('one'), item('two')];
  const p = { fs: {
    async readDir(path: string) { if (path === '/broken') throw new Error('missing target'); return [{ name: 'SKILL.md', isDir: false, isSymlink: false }, { name: 'commands', isDir: true, isSymlink: false }]; },
    async readBytes() { return new TextEncoder().encode('test'); },
    async fileSize() { return 4; },
  } } as unknown as Platform;
  p.fs.readDir = async path => { if (path === '/broken') throw new Error('missing target'); return path.endsWith('/commands') ? [{ name: 'review.md', isDir: false, isSymlink: false }] : [{ name: 'SKILL.md', isDir: false, isSymlink: false }, { name: 'commands', isDir: true, isSymlink: false }]; };
  const result = await inspectConflicts(p, items);
  expect(result.unreadable).toEqual(['/broken']);
  expect(result.conflicts['/one'].some(conflict => conflict.with === 'two')).toBe(true);
});

test('reports incomplete conflict checks when an enabled skill exceeds the size limit', async () => {
  const item = (name: string, agent: InstalledSkill['agent'], enabled = true): InstalledSkill => ({ name, agent, scope: 'global', dir: `/${name}`, enabled, hash: 'hash', managedBySomm: false, isSymlink: false });
  const items = [item('large', 'claude'), item('one', 'claude'), item('two', 'claude'), item('other', 'codex')];
  const p = { fs: {
    async readDir(path: string) { return path.endsWith('/commands') ? [{ name: 'review.md', isDir: false, isSymlink: false }] : [{ name: 'SKILL.md', isDir: false, isSymlink: false }, { name: 'commands', isDir: true, isSymlink: false }, ...(path === '/large' ? [{ name: 'image', isDir: false, isSymlink: false }] : [])]; },
    async fileSize(path: string) { return path.endsWith('/image') ? 1024 * 1024 + 1 : 4; },
    async readBytes() { return new TextEncoder().encode('test'); },
  } } as unknown as Platform;
  const result = await inspectConflicts(p, items);
  expect(result.unreadable).toEqual(['/large']);
  expect(result.conflicts['/one'].some(conflict => conflict.with === 'two')).toBe(true);
  expect(hasIncompleteConflicts(items, result.unreadable, 'claude')).toBe(true);
  expect(hasIncompleteConflicts(items, result.unreadable, 'codex')).toBe(false);
  expect(hasIncompleteConflicts(items.map(entry => entry.name === 'large' ? { ...entry, enabled: false } : entry), result.unreadable, 'claude')).toBe(false);
});

