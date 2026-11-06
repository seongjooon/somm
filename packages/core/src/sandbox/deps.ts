import type { Platform } from '../platform';
import type { DepsResult, SandboxWarning } from './index';
import { checkLinks, copy, findDeps, lockfiles, sanitize, warn } from './files';
export async function prepareDeps(p: Platform, bins: Record<string, string | null>, source: string, base: string,
  warnings: SandboxWarning[], options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<DepsResult> {
  options.signal?.throwIfAborted();
  let drift = false;
  let cloneFailed = false;
  for (const file of lockfiles) {
    const a = await p.fs.exists(`${source}/${file}`), b = await p.fs.exists(`${base}/${file}`);
    if (a !== b || (a && b && await p.fs.readText(`${source}/${file}`) !== await p.fs.readText(`${base}/${file}`))) drift = true;
  }
  if (drift) warn(warnings, 'lockfile-drift');
  const folders = await findDeps(p, source);
  if (!drift && folders.length) {
    try {
      for (const folder of folders) {
        await p.fs.mkdirp(`${base}${folder.slice(0, folder.lastIndexOf('/'))}`);
        await copy(p, `${source}${folder}`, `${base}${folder}`, warnings);
      }
      await checkLinks(p, base, base, [source, p.home]);
      await sanitize(p, base, warnings, true);
      return { mode: 'cloned', ok: true, log: '' };
    } catch {
      cloneFailed = true;
      warn(warnings, 'deps-install-failed');
      for (const folder of folders) await p.fs.remove(`${base}${folder}`);
    }
  }
  const commands = [
    ['pnpm-lock.yaml', 'pnpm', 'install', '--frozen-lockfile'],
    ['package-lock.json', 'npm', 'ci'],
    ['yarn.lock', 'yarn', 'install', '--frozen-lockfile'],
    ['uv.lock', 'uv', 'sync'],
  ];
  for (const [file, bin, ...args] of commands) {
    if (!await p.fs.exists(`${base}/${file}`)) continue;
    const cmd = [bin, ...args];
    const prefix = cloneFailed ? 'Dependency cloning failed; reinstalling\n' : '';
    if (!bins[bin]) {
      warn(warnings, 'deps-install-failed');
      return { mode: 'none', cmd, ok: false, log: `${prefix}${bin} not found` };
    }
    const deadline = AbortSignal.timeout(options.timeoutMs ?? 10 * 60_000);
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    let result;
    try { result = await p.proc.run(bins[bin]!, args, { cwd: base, signal }); }
    catch (error) { if (deadline.aborted && !options.signal?.aborted) throw new Error('Dependency installation timed out'); throw error; }
    options.signal?.throwIfAborted();
    if (deadline.aborted) throw new Error('Dependency installation timed out');
    if (result.code !== 0) warn(warnings, 'deps-install-failed');
    return { mode: 'installed', cmd, ok: result.code === 0, log: prefix + result.stdout + result.stderr };
  }
  return { mode: 'none', ok: !cloneFailed, log: cloneFailed ? 'Dependency cloning failed; no supported lockfile for recovery' : '' };
}
