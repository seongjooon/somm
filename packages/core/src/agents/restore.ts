import type { Platform } from '../platform';
import { backupDir, join, parent, validName } from './files';
import { SkillExistsError } from './types';

type Backup = { id: string; agent: string; scope: string; name: string; original_dir: string; backup_dir: string; action: string };

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
  if (!source.startsWith(`${join(p.dataDir, 'backups')}/`) || parent(source) !== join(p.dataDir, 'backups') || /[\\\0]/.test(source) || source.split('/').some(s => s === '.' || s === '..')) throw new Error('Invalid backup source');
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
    if (typeof metadata.originalDir !== 'string' || /[\\\0]/.test(metadata.originalDir) || metadata.originalDir.split('/').some(s => s === '.' || s === '..') ||
        (scope === 'global' ? metadata.originalDir !== global : !metadata.originalDir.startsWith('/') || !metadata.originalDir.endsWith(projectSuffix))) throw new Error('Invalid backup recovery metadata');
  }
  if (scope === 'project' && !isDisabled) {
    const project = target.slice(0, -projectSuffix.length) || '/';
    const configEntry = (await p.fs.readDir(project)).find(entry => entry.name === config);
    if (configEntry && (configEntry.isSymlink || !configEntry.isDir)) throw new Error('Unsafe project config symlink or non-directory');
    if (configEntry) {
      const skillsEntry = (await p.fs.readDir(join(project, config))).find(entry => entry.name === 'skills');
      if (skillsEntry && (skillsEntry.isSymlink || !skillsEntry.isDir)) throw new Error('Unsafe project skills symlink or non-directory');
    }
  }
  // Global and disabled parents are outside the webview filesystem scope.
  const targetParent = parent(target);
  const targetEntry = await p.fs.exists(targetParent)
    ? (await p.fs.readDir(targetParent)).find(entry => entry.name === name) : undefined;
  const exists = !!targetEntry;
  if (exists && !opts.overwrite) throw new SkillExistsError(target);
  const { cp } = await p.proc.which(['cp']);
  if (!cp) throw new Error('cp is required to restore backups');
  await p.fs.mkdirp(parent(target));
  const staging = join(parent(target), `.somm-restore-${crypto.randomUUID()}`);
  const previous = `${staging}-previous`;
  let moved = false;
  let sidecarMoved = false;
  let sidecarInstalled = false;
  let preserve = false;
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
      const failures: unknown[] = [];
      const attempt = async (action: () => Promise<void>) => { try { await action(); } catch (failure) { failures.push(failure); } };
      await attempt(async () => { if (await p.fs.exists(target)) await p.fs.remove(target); });
      if (sidecarInstalled) await attempt(() => p.fs.remove(sidecar));
      if (sidecarMoved) await attempt(async () => { await p.fs.rename(`${previous}.json`, sidecar); sidecarMoved = false; });
      if (moved) await attempt(async () => { await p.fs.rename(previous, target); moved = false; });
      if (failures.length) {
        preserve = true;
        throw new Error(`Restore rollback incomplete; inspect recovery paths ${previous}, ${previous}.json, ${staging}, ${staging}.json`, { cause: error });
      }
      throw error;
    }
    if (moved) { await p.fs.remove(previous); moved = false; }
    if (sidecarMoved) await p.fs.remove(`${previous}.json`);
  } finally {
    if (!preserve && await p.fs.exists(staging)) await p.fs.remove(staging);
    if (!preserve && await p.fs.exists(`${staging}.json`)) await p.fs.remove(`${staging}.json`);
  }
}
