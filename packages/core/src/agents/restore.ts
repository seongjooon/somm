import type { Platform } from '../platform';
import { backupDir, join, parent, validName } from './files';
import { SkillExistsError } from './types';

type Backup = { id: string; agent: string; scope: string; name: string; original_dir: string; backup_dir: string; action: string };

async function safeParents(p: Platform, path: string): Promise<void> {
  let current = '';
  for (const part of parent(path).split('/').filter(Boolean)) {
    const dir = current || '/';
    if (!await p.fs.exists(dir)) break;
    const entry = (await p.fs.readDir(dir)).find(e => e.name === part);
    if (!entry) break;
    if (entry.isSymlink || !entry.isDir) throw new Error('Unsafe symlink or non-directory in backup path');
    current = join(dir, part);
  }
}

export async function restoreBackup(p: Platform, backupId: string, opts: { overwrite?: boolean } = {}): Promise<void> {
  const [row] = await p.db.select<Backup>('SELECT * FROM backups WHERE id = ?', [backupId]);
  if (!row || row.action !== 'backup') throw new Error('Backup not found');
  const { original_dir: target, backup_dir: source, agent, scope, name } = row;
  validName(name);
  const parts = target.split('/');
  if (!target.startsWith('/') || parts.some(s => s === '.' || s === '..') || /[\\\0]/.test(target) ||
      !['claude', 'codex'].includes(agent) || !['global', 'project'].includes(scope)) throw new Error('Invalid backup target');
  const config = agent === 'claude' ? '.claude' : '.agents';
  const global = join(p.home, config, 'skills', name);
  const disabled = join(p.dataDir, 'disabled', agent, scope, name);
  const projectSuffix = `/${config}/skills/${name}`;
  if (target !== disabled && (scope === 'global' ? target !== global : !target.endsWith(projectSuffix) || target === global)) throw new Error('Invalid backup target');
  if (!source.startsWith(`${join(p.dataDir, 'backups')}/`) || parent(source) !== join(p.dataDir, 'backups') || source.split('/').some(s => s === '.' || s === '..')) throw new Error('Invalid backup source');
  await safeParents(p, target);
  await safeParents(p, source);
  if (!await p.fs.exists(source)) throw new Error('Backup is missing');
  const sourceEntry = (await p.fs.readDir(parent(source))).find(entry => entry.name === source.split('/').pop());
  if (sourceEntry?.isSymlink) throw new Error('Symlink backup requires a verified target');
  const sidecar = `${target}.somm-disabled.json`;
  const sourceSidecar = `${source}.somm-disabled.json`;
  const isDisabled = target === disabled;
  let sidecarText: string | undefined;
  if (isDisabled) {
    if (!await p.fs.exists(sourceSidecar)) throw new Error('Backup recovery metadata is missing');
    sidecarText = await p.fs.readText(sourceSidecar);
    const metadata = JSON.parse(sidecarText) as { originalDir?: unknown };
    if (typeof metadata.originalDir !== 'string' || metadata.originalDir.split('/').some(s => s === '.' || s === '..') ||
        (scope === 'global' ? metadata.originalDir !== global : !metadata.originalDir.startsWith('/') || !metadata.originalDir.endsWith(projectSuffix))) throw new Error('Invalid backup recovery metadata');
  }
  const exists = await p.fs.exists(target);
  if (exists && !opts.overwrite) throw new SkillExistsError(target);
  const { cp } = await p.proc.which(['cp']);
  if (!cp) throw new Error('cp is required to restore backups');
  await p.fs.mkdirp(parent(target));
  const staging = join(parent(target), `.somm-restore-${crypto.randomUUID()}`);
  const previous = `${staging}-previous`;
  let moved = false;
  let sidecarMoved = false;
  let sidecarInstalled = false;
  try {
    if ((await p.proc.run(cp, ['-R', '-P', source, staging])).code !== 0) throw new Error('Backup copy failed');
    if (sidecarText !== undefined) await p.fs.writeText(`${staging}.json`, sidecarText);
    if (exists) { await backupDir(p, target); await p.fs.rename(target, previous); moved = true; }
    try {
      if (isDisabled && await p.fs.exists(sidecar)) { await p.fs.rename(sidecar, `${previous}.json`); sidecarMoved = true; }
      await p.fs.rename(staging, target);
      if (isDisabled) { await p.fs.rename(`${staging}.json`, sidecar); sidecarInstalled = true; }
      await p.db.execute('INSERT INTO backups (id, agent, scope, name, original_dir, backup_dir, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [crypto.randomUUID(), agent, scope, name, target, source, 'restore', new Date().toISOString()]);
    } catch (error) {
      if (await p.fs.exists(target)) await p.fs.remove(target);
      if (sidecarInstalled) await p.fs.remove(sidecar);
      if (sidecarMoved) { await p.fs.rename(`${previous}.json`, sidecar); sidecarMoved = false; }
      if (moved) { await p.fs.rename(previous, target); moved = false; }
      throw error;
    }
    if (moved) { await p.fs.remove(previous); moved = false; }
    if (sidecarMoved) await p.fs.remove(`${previous}.json`);
  } finally {
    if (await p.fs.exists(staging)) await p.fs.remove(staging);
    if (await p.fs.exists(`${staging}.json`)) await p.fs.remove(`${staging}.json`);
  }
}
