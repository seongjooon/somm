import { hashFiles, type Platform } from '../platform';
import type { AgentId, InstalledSkill, Scope } from '../types';
import { backupDir, entries, join, parent, skillHash, validFile, validName } from './files';
import { SkillMoveRecoveryError, SkillExistsError, type InstallOptions, type SkillInput } from './types';

export function installation(p: Platform, id: AgentId) {
  const config = id === 'claude' ? '.claude' : '.agents';
  function skillDir(scope: Scope, projectDir?: string): string {
    const root = scope === 'global' ? p.home : projectDir;
    if (!root?.startsWith('/') || root.split('/').includes('..')) throw new Error('Absolute project directory required');
    return join(root, config, 'skills');
  }
  const disabledRoot = (scope: Scope) => join(p.dataDir, 'disabled', id, scope);
  const disabledPath = (item: InstalledSkill) => join(disabledRoot(item.scope), item.name);
  const sidecar = (dir: string) => `${dir}.somm-disabled.json`;
  async function inspect(dir: string, scope: Scope, enabled: boolean): Promise<InstalledSkill> {
    const name = dir.split('/').pop()!;
    const entry = (await p.fs.readDir(parent(dir))).find(e => e.name === name)!;
    const metadataPath = join(dir, '.somm.json');
    let hash: string | undefined;
    if (await p.fs.exists(metadataPath)) {
      const data = JSON.parse(await p.fs.readText(metadataPath));
      if (typeof data.hash === 'string') hash = data.hash;
    }
    const missingTarget = entry.isSymlink && !await p.fs.exists(join(dir, 'SKILL.md'));
    return { agent: id, scope, name, dir, enabled, hash: missingTarget ? '' : await skillHash(p, dir), managedBySomm: !!hash, isSymlink: entry.isSymlink };
  }
  function validate(item: InstalledSkill): void {
    validName(item.name);
    if (item.agent !== id) throw new Error('Wrong agent');
    if (!item.enabled) {
      if (item.dir !== disabledPath(item)) throw new Error('Invalid disabled path');
    } else if (item.scope === 'global') {
      if (item.dir !== join(skillDir('global'), item.name)) throw new Error('Invalid global path');
    } else if (!item.dir.startsWith('/') || item.dir.split('/').includes('..') || !item.dir.endsWith(`/${config}/skills/${item.name}`)) {
      throw new Error('Invalid project path');
    }
  }
  async function listInstalled(projectDir?: string): Promise<InstalledSkill[]> {
    const result: InstalledSkill[] = [];
    for (const scope of ['global', 'project'] as const) {
      if (scope === 'project' && !projectDir) continue;
      for (const e of await entries(p, skillDir(scope, projectDir))) {
        const dir = join(skillDir(scope, projectDir), e.name);
        if ((e.isDir || e.isSymlink) && await p.fs.exists(join(dir, 'SKILL.md'))) result.push(await inspect(dir, scope, true));
      }
      for (const e of await entries(p, disabledRoot(scope))) {
        const dir = join(disabledRoot(scope), e.name);
        if (!(e.isDir || e.isSymlink)) continue;
        if (!await p.fs.exists(join(dir, 'SKILL.md')) && !(e.isSymlink && await p.fs.exists(sidecar(dir)))) continue;
        if (scope === 'project') {
          if (!await p.fs.exists(sidecar(dir))) continue;
          const { originalDir } = JSON.parse(await p.fs.readText(sidecar(dir)));
          if (originalDir !== join(skillDir(scope, projectDir), e.name)) continue;
        }
        result.push(await inspect(dir, scope, false));
      }
    }
    return result;
  }
  async function install(skill: SkillInput, scope: Scope, opts: InstallOptions): Promise<InstalledSkill> {
    validName(skill.name);
    for (const f of skill.files) validFile(f.path);
    if (!skill.files.some(f => f.path === 'SKILL.md')) throw new Error('SKILL.md is required');
    if (new Set(skill.files.map(f => f.path)).size !== skill.files.length) throw new Error('Duplicate skill file');
    if (opts.mode === 'symlink' && (!opts.symlinkSource?.startsWith('/') || opts.symlinkSource.split('/').some(s => s === '.' || s === '..') || !await p.fs.exists(join(opts.symlinkSource, 'SKILL.md')))) {
      throw new Error('Absolute symlink source containing SKILL.md required');
    }
    const dir = join(skillDir(scope, opts.projectDir), skill.name);
    if (opts.mode === 'symlink' && (opts.symlinkSource === dir || opts.symlinkSource!.startsWith(`${dir}/`))) throw new Error('Symlink source overlaps install');
    if (await p.fs.exists(dir) && !opts.overwrite) throw new SkillExistsError(dir);
    await p.fs.mkdirp(parent(dir));
    const staging = join(parent(dir), `.somm-${crypto.randomUUID()}`);
    try {
      if (opts.mode === 'symlink') await p.fs.symlink(opts.symlinkSource!, staging);
      else {
        await p.fs.mkdirp(staging);
        for (const file of skill.files) {
          const path = join(staging, file.path);
          await p.fs.mkdirp(parent(path));
          if (typeof file.contents === 'string') await p.fs.writeText(path, file.contents);
          else await p.fs.writeBytes(path, file.contents);
        }
        await p.fs.writeText(join(staging, '.somm.json'), JSON.stringify({ source: skill.source, hash: await hashFiles(skill.files), installedAt: new Date().toISOString() }));
      }
      let previous: string | undefined;
      if (await p.fs.exists(dir)) {
        await backupDir(p, dir);
        previous = join(parent(dir), `.somm-previous-${crypto.randomUUID()}`);
        await p.fs.rename(dir, previous);
      }
      try { await p.fs.rename(staging, dir); }
      catch (error) { if (previous) await p.fs.rename(previous, dir); throw error; }
      if (previous) await p.fs.remove(previous);
    } finally { if (await p.fs.exists(staging)) await p.fs.remove(staging); }
    return inspect(dir, scope, true);
  }
  async function uninstall(item: InstalledSkill): Promise<void> {
    validate(item);
    await backupDir(p, item.dir);
    await p.fs.remove(item.dir);
    if (!item.enabled && await p.fs.exists(sidecar(item.dir))) await p.fs.remove(sidecar(item.dir));
  }
  async function move(from: string, to: string, symlink: boolean, linkTarget?: string): Promise<void> {
    const staging = join(parent(to), `.somm-move-${crypto.randomUUID()}`);
    try {
      if (symlink) {
        if (!linkTarget) throw new Error('Missing symlink target');
        await p.fs.symlink(linkTarget, staging);
      } else {
        try { await p.fs.rename(from, to); return; }
        catch (error) { if ((error as { code?: string }).code !== 'EXDEV') throw error; }
        const { cp } = await p.proc.which(['cp']);
        if (!cp) throw new Error('cp is required for cross-volume skill moves');
        const copied = await p.proc.run(cp, ['-R', '-P', from, staging]);
        if (copied.code !== 0) throw new Error('Skill move copy failed');
      }
      await p.fs.rename(staging, to);
      try { await p.fs.remove(from); }
      catch (error) { throw new SkillMoveRecoveryError(from, to, error); }
    } finally { if (await p.fs.exists(staging)) await p.fs.remove(staging); }
  }
  async function setEnabled(item: InstalledSkill, enabled: boolean): Promise<InstalledSkill> {
    validate(item);
    if (item.enabled === enabled) return item;
    const disabled = disabledPath(item);
    const metadata = enabled ? JSON.parse(await p.fs.readText(sidecar(disabled))) : { originalDir: item.dir };
    const originalDir = metadata.originalDir;
    const originalTarget = item.isSymlink ? (enabled ? metadata.linkTarget : await p.fs.readlink(item.dir)) : undefined;
    if (item.isSymlink && (typeof originalTarget !== 'string' || !originalTarget)) throw new Error('Missing original symlink target');
    const linkTarget = originalTarget && !enabled && !originalTarget.startsWith('/') ? `${parent(item.dir)}/${originalTarget}` : originalTarget;
    // Retain the disabled link and recovery metadata until its target can be validated.
    if (enabled && item.isSymlink && !await p.fs.exists(join(item.dir, 'SKILL.md'))) {
      throw new Error(`Cannot enable missing skill target; restore target first. Recovery metadata retained at ${sidecar(disabled)}`);
    }
    const target = enabled ? originalDir : disabled;
    validate({ ...item, enabled: true, dir: originalDir });
    if (await p.fs.exists(target)) throw new SkillExistsError(target);
    await p.fs.mkdirp(parent(target));
    if (!enabled) await p.fs.writeText(sidecar(disabled), JSON.stringify({ originalDir, linkTarget: originalTarget }));
    try { await move(item.dir, target, item.isSymlink, linkTarget); }
    catch (error) {
      if (!(error instanceof SkillMoveRecoveryError) && !enabled && await p.fs.exists(sidecar(disabled))) await p.fs.remove(sidecar(disabled));
      throw error;
    }
    if (enabled) await p.fs.remove(sidecar(disabled));
    return inspect(target, item.scope, enabled);
  }
  return { skillDir, listInstalled, install, uninstall, setEnabled };
}
