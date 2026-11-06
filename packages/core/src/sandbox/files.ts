import type { Platform } from '../platform';
import type { SandboxWarning } from './index';
export const excluded = new Set(['node_modules', '.venv', 'venv', 'target', 'dist', '.git']);
export const dependencyDirs = new Set(['node_modules', '.venv', 'venv']);
export const lockfiles = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'uv.lock'];
export const secret = (name: string) => name === '.env' || (name.startsWith('.env.') && name !== '.env.example') ||
  /\.(pem|key)$/.test(name) || name.startsWith('id_rsa') || ['.npmrc', '.pypirc'].includes(name);
export function warn(warnings: SandboxWarning[], value: SandboxWarning) {
  if (!warnings.includes(value)) warnings.push(value);
}
export async function copy(p: Platform, from: string, to: string, warnings: SandboxWarning[]) {
  const fast = await p.proc.run('cp', ['-cR', from, to]);
  if (fast.code === 0) return;
  await p.fs.remove(to);
  warn(warnings, 'slow-copy');
  const result = await p.proc.run('cp', ['-R', from, to]);
  if (result.code !== 0) throw new Error('Sandbox copy failed');
}
export async function copyProject(p: Platform, from: string, to: string, warnings: SandboxWarning[]) {
  await p.fs.mkdirp(to);
  for (const entry of await p.fs.readDir(from)) {
    if (excluded.has(entry.name) || entry.isSymlink) continue;
    if (entry.isDir) await copyProject(p, `${from}/${entry.name}`, `${to}/${entry.name}`, warnings);
    else await copy(p, `${from}/${entry.name}`, `${to}/${entry.name}`, warnings);
  }
}
// Remove project symlinks before traversal so sanitation never follows paths into the source or home.
export async function sanitize(p: Platform, dir: string, warnings: SandboxWarning[], preserveLinks = false) {
  for (const entry of await p.fs.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if ((entry.isSymlink && !preserveLinks) || secret(entry.name)) {
      await p.fs.remove(path);
      if (secret(entry.name)) warn(warnings, 'secrets-removed');
    } else if (!entry.isSymlink && entry.isDir) await sanitize(p, path, warnings, preserveLinks);
  }
}
export async function findDeps(p: Platform, dir: string, relative = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await p.fs.readDir(`${dir}${relative}`)) {
    if (entry.isSymlink || !entry.isDir) continue;
    const path = `${relative}/${entry.name}`;
    if (dependencyDirs.has(entry.name)) found.push(path);
    else if (!excluded.has(entry.name)) found.push(...await findDeps(p, dir, path));
  }
  return found;
}
// Resolve symlinks component by component (Fs has no realpath); missing tails are kept as-is.
export async function realPath(p: Platform, path: string): Promise<string> {
  const pending = path.split('/'), resolved: string[] = [];
  let hops = 0;
  while (pending.length) {
    const part = pending.shift()!;
    if (!part || part === '.') continue;
    if (part === '..') { resolved.pop(); continue; }
    let entry;
    try { entry = (await p.fs.readDir('/' + resolved.join('/'))).find(e => e.name === part); } catch { entry = undefined; }
    if (!entry) { resolved.push(part, ...pending.filter(x => x && x !== '.')); break; }
    if (entry.isSymlink) {
      if (++hops > 40) throw new Error('Symlink cycle in path');
      const next = await p.fs.readlink('/' + [...resolved, part].join('/'));
      if (next.startsWith('/')) resolved.length = 0;
      pending.unshift(...next.split('/'));
    } else resolved.push(part);
  }
  return '/' + resolved.join('/');
}
// Resolve each component before processing '..', matching filesystem symlink semantics.
export async function checkLinks(p: Platform, dir: string, root: string, protectedInput: string[]): Promise<void> {
  const protectedDirs = [...protectedInput, ...await Promise.all(protectedInput.map(d => realPath(p, d)))];
  await scan(p, dir, root, protectedDirs);
}
async function scan(p: Platform, dir: string, root: string, protectedDirs: string[]): Promise<void> {
  const resolveAbs = (target: string) => realPath(p, target);
  // Absolute links to system paths (e.g. .venv/bin/python) are kept; links into the project or home are not.
  const absolute = async (target: string) => {
    const path = (await resolveAbs(target)).replace(/\/+$/, '');
    if (protectedDirs.some(d => { d = d.replace(/\/+$/, ''); return path === d || path.startsWith(`${d}/`) || d.startsWith(`${path}/`) || path === ''; })) {
      throw new Error('Dependency symlink points into project or home');
    }
  };
  async function resolve(target: string, parent: string): Promise<void> {
    if (target.startsWith('/')) return absolute(target);
    const resolved = parent.slice(root.length).split('/').filter(Boolean);
    const pending = target.split('/');
    let hops = 0;
    while (pending.length) {
      const part = pending.shift()!;
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!resolved.length) throw new Error('Dependency symlink escapes sandbox');
        resolved.pop();
        continue;
      }
      const directory = root + (resolved.length ? '/' + resolved.join('/') : '');
      const entry = (await p.fs.readDir(directory)).find(e => e.name === part);
      if (!entry) throw new Error('Unresolved dependency symlink');
      if (entry.isSymlink) {
        if (++hops > 40) throw new Error('Dependency symlink cycle');
        const next = await p.fs.readlink(`${directory}/${part}`);
        if (next.startsWith('/')) return absolute(next);
        pending.unshift(...next.split('/'));
      } else {
        if (pending.some(x => x && x !== '.') && !entry.isDir) throw new Error('Invalid dependency symlink target');
        resolved.push(part);
      }
    }
  }
  for (const entry of await p.fs.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isSymlink) await resolve(await p.fs.readlink(path), dir);
    else if (entry.isDir) await scan(p, path, root, protectedDirs);
  }
}
