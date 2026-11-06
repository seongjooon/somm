import { hashFiles, type Platform } from '../platform';
import type { SkillFile } from '../types';

export function join(...parts: string[]): string { return parts.join('/').replace(/\/+/g, '/').replace(/\/$/, '') || '/'; }
export function parent(path: string): string { return path.slice(0, path.lastIndexOf('/')) || '/'; }
export function validName(name: string): void {
  if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name) || name.startsWith('-')) throw new Error('Invalid skill name');
}
export function validFile(path: string): void {
  if (!path || path.startsWith('/') || /[\\\0]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..') || path === '.somm.json') {
    throw new Error('Invalid skill file path');
  }
}
export async function entries(p: Platform, dir: string) { return await p.fs.exists(dir) ? p.fs.readDir(dir) : []; }
export async function readFiles(p: Platform, dir: string, prefix = ''): Promise<SkillFile[]> {
  const files: SkillFile[] = [];
  for (const e of await p.fs.readDir(join(dir, prefix))) {
    if (e.name === '.somm.json' || e.isSymlink) continue;
    const path = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDir) files.push(...await readFiles(p, dir, path));
    else files.push({ path, contents: await p.fs.readBytes(join(dir, path)) });
  }
  return files;
}
export async function skillHash(p: Platform, dir: string): Promise<string> { return hashFiles(await readFiles(p, dir)); }

export async function backupDir(p: Platform, dir: string): Promise<string> {
  const id = `${Date.now()}-${crypto.randomUUID()}`;
  const name = dir.split('/').pop()!;
  validName(name);
  const backup = join(p.dataDir, 'backups', `${id}-${name}`);
  const { cp } = await p.proc.which(['cp']);
  if (!cp) throw new Error('cp is required to preserve backup symlinks');
  await p.fs.mkdirp(parent(backup));
  const disabled = dir.startsWith(join(p.dataDir, 'disabled') + '/') ? dir.slice(join(p.dataDir, 'disabled').length + 1).split('/') : null;
  const sidecar = `${dir}.somm-disabled.json`;
  const backupSidecar = `${backup}.somm-disabled.json`;
  try {
    const result = await p.proc.run(cp, ['-R', '-P', dir, backup]);
    if (result.code !== 0) throw new Error('Skill backup failed');
    if (disabled && await p.fs.exists(sidecar)) {
      await p.fs.writeText(backupSidecar, await p.fs.readText(sidecar));
    }
    const agent = disabled?.[0] ?? (dir.includes('/.claude/skills/') ? 'claude' : dir.includes('/.agents/skills/') ? 'codex' : null);
    const globalRoot = agent === 'claude' ? join(p.home, '.claude/skills', name) : join(p.home, '.agents/skills', name);
    await p.db.execute('INSERT INTO backups (id, agent, scope, name, original_dir, backup_dir, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [id, agent, disabled?.[1] ?? (dir === globalRoot ? 'global' : 'project'), name, dir, backup, 'backup', new Date().toISOString()]);
  } catch (error) {
    // The original remains untouched; unrecorded copies are safe to discard.
    for (const path of [backupSidecar, backup]) {
      try { if (await p.fs.exists(path)) await p.fs.remove(path); } catch { /* Preserve the original failure if cleanup is denied. */ }
    }
    throw error;
  }
  return backup;
}
