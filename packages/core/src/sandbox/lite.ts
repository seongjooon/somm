import type { Platform } from '../platform';
import type { Sandbox, SandboxWarning } from './index';
import { copy, copyProject, excluded, sanitize, warn } from './files';
import { prepareDeps } from './deps';
export const SANDBOX_GIT_ENV = {
  GIT_AUTHOR_NAME: 'somm', GIT_AUTHOR_EMAIL: 'somm@localhost',
  GIT_COMMITTER_NAME: 'somm', GIT_COMMITTER_EMAIL: 'somm@localhost',
};
const identifier = (value: string) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) throw new Error('Invalid sandbox identifier');
  return value;
};
export function createLiteSandbox(p: Platform, bins: Record<string, string | null>): Sandbox {
  const runs = `${p.dataDir.replace(/\/$/, '')}/runs`;
  const active = new Map<string, SandboxWarning[]>();
  const gitBin = bins.git || 'git';
  // nodeProc merges env into process.env, so PATH is inherited.
  const configs = new Map<string, { restore(): Promise<void>; dispose(): Promise<void> }>();
  const pending = new Map<string, string>();
  const scrub = Object.fromEntries(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_EXTERNAL_DIFF', 'GIT_ASKPASS', 'GIT_SSH_COMMAND', 'GIT_PAGER'].map(k => [k, null]));
  async function gitRun(cwd: string, args: string[], env: Record<string, string> = {}) {
    return p.proc.run(gitBin, ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false',
      '-c', 'core.attributesFile=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'core.excludesFile=/dev/null', ...args],
    { cwd, env: { ...scrub, ...SANDBOX_GIT_ENV, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...env } });
  }
  async function git(cwd: string, args: string[], env: Record<string, string> = {}) {
    const result = await gitRun(cwd, args, env);
    if (result.code !== 0) throw new Error(`Sandbox git ${args[0]} failed`);
    return result.stdout;
  }
  async function owned(path: string) {
    if (!path.startsWith(`${runs}/`) || path.split('/').some(part => part === '..' || part === '.')) {
      throw new Error('Path is outside sandbox');
    }
    const [id] = path.slice(runs.length + 1).split('/');
    if (!active.has(id)) throw new Error('Unknown sandbox run');
    // Platform dataDir ancestors are trusted (macOS /var itself is a system symlink).
    if (!await p.fs.exists(p.dataDir)) return;
    if (await p.fs.isSymlink(p.dataDir)) throw new Error('Sandbox path contains symlink');
    let parent = p.dataDir;
    for (const part of path.slice(parent.length + 1).split('/').filter(Boolean)) {
      const entries = await p.fs.readDir(parent || '/');
      const entry = entries.find(e => e.name === part);
      if (entry?.isSymlink) throw new Error('Sandbox path contains symlink');
      parent += `/${part}`;
      if (!entry) break;
    }
  }
  return {
    async prepare(projectDir, runId, options?: { deferDependencies?: boolean }) {
      const root = `${runs}/${identifier(runId)}`, base = `${root}/base`;
      if (!projectDir.startsWith('/') || projectDir.split('/').includes('..')) throw new Error('Expected absolute project path');
      async function canonical(path: string): Promise<string> {
        const tail: string[] = [];
        while (!await p.fs.exists(path)) {
          tail.unshift(path.slice(path.lastIndexOf('/') + 1));
          path = path.slice(0, path.lastIndexOf('/')) || '/';
        }
        const result = await p.proc.run('pwd', ['-P'], { cwd: path });
        if (result.code !== 0) throw new Error('Cannot resolve sandbox path');
        return [(result.stdout.trim().replace(/\/$/, '') || '/'), ...tail].join('/').replace(/\/+/g, '/');
      }
      const sourcePath = await canonical(projectDir), dataPath = await canonical(p.dataDir);
      if (sourcePath === '/' || dataPath === '/' || dataPath === sourcePath || dataPath.startsWith(`${sourcePath}/`) || sourcePath.startsWith(`${dataPath}/`)) {
        throw new Error('Sandbox data directory must be separate from the source project');
      }
      if (await p.fs.exists(root)) throw new Error('Sandbox run already exists');
      const warnings: SandboxWarning[] = [];
      active.set(runId, warnings);
      let created = false;
      try {
        await owned(root);
        await p.fs.mkdirp(base);
        created = true;
        const noLocks = { GIT_OPTIONAL_LOCKS: '0' };
        const probe = await gitRun(projectDir, ['rev-parse', '--show-toplevel'], noLocks);
        if (probe.code === 0) {
          if ((await git(projectDir, ['rev-parse', '--show-prefix'], noLocks)).trim()) throw new Error('Select the repository root');
          if ((await git(projectDir, ['status', '--porcelain'], noLocks)).trim()) warn(warnings, 'uncommitted-changes');
          await git(projectDir, ['archive', '-o', `${root}/base.tar`, 'HEAD'], noLocks);
          const unpack = await p.proc.run('tar', ['-xf', `${root}/base.tar`, '-C', base]);
          if (unpack.code !== 0) throw new Error('Sandbox archive extraction failed');
          await p.fs.remove(`${root}/base.tar`);
        } else {
          warn(warnings, 'not-git');
          await copyProject(p, projectDir, base, warnings);
        }
        if (await p.fs.exists(`${base}/.gitmodules`)) warn(warnings, 'submodules');
        async function lfs(dir: string): Promise<boolean> {
          for (const entry of await p.fs.readDir(dir)) {
            if (entry.isSymlink) continue;
            if (entry.name === '.gitattributes' && /filter\s*=\s*lfs/.test(await p.fs.readText(`${dir}/${entry.name}`))) return true;
            if (entry.isDir && !excluded.has(entry.name) && await lfs(`${dir}/${entry.name}`)) return true;
          }
          return false;
        }
        if (await lfs(base)) warn(warnings, 'lfs');
        await sanitize(p, base, warnings);
        const deps = options?.deferDependencies ? { mode: 'none' as const, ok: true, log: '' } : await prepareDeps(p, bins, projectDir, base, warnings);
        if (options?.deferDependencies) pending.set(runId, projectDir);
        await git(base, ['init', '-q']);
        await p.fs.writeText(`${base}/.git/info/exclude`, [...excluded].filter(x => x !== '.git').join('/\n') + '/\n');
        await git(base, ['add', '-Af', '--', '.',
          ...[...excluded].filter(x => x !== '.git').map(x => `:(glob,exclude)**/${x}/**`)]);
        await git(base, ['commit', '--allow-empty', '-qm', 'baseline']);
        configs.set(runId, await p.fs.snapshotSandboxGitConfig(p.dataDir, base, runId));
        return { base, deps, warnings };
      } catch (error) {
        if (created) await p.fs.remove(root);
        active.delete(runId);
        pending.delete(runId);
        throw error;
      }
    },
    async preparePreflight(projectDir, runId) {
      return this.prepare(projectDir, runId, { deferDependencies: true });
    },
    async prepareDependencies(base, options) {
      await owned(base);
      if (!base.endsWith('/base')) throw new Error('Expected sandbox base');
      const runId = base.slice(runs.length + 1, -5);
      const source = pending.get(runId);
      if (!source) throw new Error('No pending dependency preparation');
      pending.delete(runId);
      const deps = await prepareDeps(p, bins, source, base, active.get(runId)!, options);
      options?.signal?.throwIfAborted();
      await configs.get(runId)!.restore();
      await p.fs.remove(`${base}/.git/info/attributes`);
      await p.fs.writeText(`${base}/.git/info/exclude`, [...excluded].filter(x => x !== '.git').join('/\n') + '/\n');
      await git(base, ['add', '-Af', '--', '.', ...[...excluded].filter(x => x !== '.git').map(x => `:(glob,exclude)**/${x}/**`)]);
      await git(base, ['commit', '--allow-empty', '-qm', 'dependencies']);
      options?.signal?.throwIfAborted();
      return deps;
    },
    async split(base, arms) {
      await owned(base);
      if (!base.endsWith('/base')) throw new Error('Expected sandbox base');
      if (new Set(arms).size !== arms.length || arms.some(x => identifier(x) === 'base')) throw new Error('Invalid sandbox arms');
      const root = base.slice(0, -5);
      const result: Record<string, string> = {};
      for (const arm of arms) {
        const path = `${root}/${arm}`;
        if (await p.fs.exists(path)) throw new Error('Sandbox arm already exists');
      }
      for (const arm of arms) {
        const path = `${root}/${arm}`;
        await copy(p, base, path, active.get(root.slice(runs.length + 1))!);
        result[arm] = path;
      }
      return result;
    },
    async plantCanaries({ projectDir, homeDir }) {
      await owned(projectDir);
      if (homeDir) await owned(homeDir);
      const rel = projectDir.slice(runs.length + 1).split('/');
      const [runId, arm] = rel;
      if (rel.length !== 2 || !/^[ab]-[0-9]+$/.test(arm) || (homeDir && homeDir !== `${runs}/${runId}/home-${arm}`)) throw new Error('Invalid sandbox arm');
      return p.fs.createCanaries(p.dataDir, runId, arm, !!homeDir);
    },
    async removeCanaries(projectDir, canaries) {
      await owned(projectDir);
      const [runId, arm, ...extra] = projectDir.slice(runs.length + 1).split('/');
      if (extra.length || !/^[ab]-[0-9]+$/.test(arm)) throw new Error('Invalid sandbox arm');
      return p.fs.removeCanaries(p.dataDir, runId, arm, canaries);
    },
    async diffStat(armDir) {
      await owned(armDir);
      const runId = armDir.slice(runs.length + 1).split('/')[0], arm = armDir.slice(runs.length + 2 + runId.length);
      if (!arm || arm.includes('/') || arm === 'base') throw new Error('Expected sandbox arm');
      // Never touch the arm's own .git (agent-controlled): use the base git dir with the arm as work tree and a throwaway index.
      // Accepted limitation: an arm .gitignore can hide its own changes; ignored files are not force-added.
      // The base is unsandboxed too: restore its trusted config and drop attributes before every use.
      await configs.get(runId)!.restore();
      await p.fs.remove(`${runs}/${runId}/base/.git/info/attributes`);
      const index = `${runs}/${runId}/.index-${arm}-${crypto.randomUUID()}`;
      const g = (args: string[]) => git(armDir, ['--git-dir', `${runs}/${runId}/base/.git`, '--work-tree', armDir, ...args], { GIT_INDEX_FILE: index });
      let numstat: string, patch: string;
      try {
        await g(['read-tree', 'HEAD']);
        await g(['add', '-A']);
        numstat = await g(['diff', '--cached', '--no-ext-diff', '--no-textconv', '--numstat', 'HEAD', '--']);
        patch = await g(['diff', '--cached', '--no-ext-diff', '--no-textconv', 'HEAD', '--']);
      } finally { for (const f of [index, `${index}.lock`]) await p.fs.remove(f).catch(() => {}); }
      let files = 0, added = 0, removed = 0;
      for (const line of numstat.trim().split('\n').filter(Boolean)) {
        const [a, r] = line.split('\t'); files++;
        added += Number.parseInt(a, 10) || 0; removed += Number.parseInt(r, 10) || 0;
      }
      return { files, added, removed, patch };
    },
    async cleanup(runId) {
      const root = `${runs}/${identifier(runId)}`;
      if (!active.has(runId)) return;
      try { await owned(root); await p.fs.remove(root); }
      finally {
        try { await configs.get(runId)?.dispose(); }
        finally { active.delete(runId); configs.delete(runId); pending.delete(runId); }
      }
    },
  };
}
