import { expect, test } from 'vitest';
import { nodeFs as fs } from '../node/fs';
import type { Platform, Proc } from '../platform';
import { createLiteSandbox } from './lite';
import { root, project, p, bins, git, fixture, evilScript } from './lite-test-helpers';
test('archives HEAD, strips secrets, warns about limitations, and uses isolated Git identity', async () => {
  await fixture({ '.env': 'fixture-secret', '.env.example': 'PUBLIC=example', '.npmrc': 'fixture-only',
    '.gitmodules': '', '.gitattributes': '*.bin filter=lfs diff=lfs merge=lfs -text' });
  await fs.writeText(`${project}/main.txt`, 'uncommitted');
  const sandbox = createLiteSandbox(p, bins);
  const { base, warnings } = await sandbox.prepare(project, 'test');
  expect(warnings).toEqual(expect.arrayContaining(['uncommitted-changes', 'secrets-removed', 'submodules', 'lfs']));
  expect(await fs.readText(`${base}/main.txt`)).toBe('old\nkeep\n');
  expect(await fs.exists(`${base}/.env`)).toBe(false);
  expect(await fs.exists(`${base}/.npmrc`)).toBe(false);
  expect(await fs.exists(`${base}/.env.example`)).toBe(true);
  expect(await git(['log', '-1', '--format=%an <%ae>'], base)).toBe('somm <somm@localhost>');
  expect(await git(['remote'], base)).toBe('');
  expect(await fs.readText(`${project}/.env`)).toBe('fixture-secret');
  await sandbox.cleanup('test'); expect(await fs.exists(`${p.dataDir}/runs/test`)).toBe(false);
});
test('copies non-git projects, excluding build artifacts, secrets and symlinks', async () => {
  await fs.writeText(`${project}/main.txt`, 'source');
  for (const dir of ['node_modules', 'dist', 'target', '.venv']) {
    await fs.mkdirp(`${project}/${dir}`); await fs.writeText(`${project}/${dir}/fixture`, 'dependency');
  }
  await fs.writeText(`${project}/private.pem`, 'fake-key');
  await fs.symlink(`${root}/empty-home`, `${project}/external`);
  const { base, warnings, deps } = await createLiteSandbox(p, bins).prepare(project, 'plain');
  expect(warnings).toContain('not-git'); expect(warnings).toContain('secrets-removed');
  expect(deps.mode).toBe('cloned');
  expect(await fs.exists(`${base}/dist`)).toBe(false);
  expect(await fs.exists(`${base}/external`)).toBe(false);
  expect(await fs.readText(`${base}/main.txt`)).toBe('source');
});
test('lockfile drift reinstalls HEAD dependencies using the frozen lockfile', async () => {
  await fixture({ 'pnpm-lock.yaml': 'old-lock' });
  await fs.writeText(`${project}/pnpm-lock.yaml`, 'new-lock');
  await fs.mkdirp(`${project}/node_modules`);
  const calls: { args: string[]; cwd?: string }[] = [];
  const proc: Proc = { ...p.proc, async run(bin, args, opts) {
    if (bin === 'pnpm') { calls.push({ args, cwd: opts?.cwd }); return { code: 0, stdout: 'fixture install', stderr: '' }; }
    return p.proc.run(bin, args, opts);
  } };
  const result = await createLiteSandbox({ ...p, proc }, bins).prepare(project, 'drift');
  expect(result.warnings).toContain('lockfile-drift');
  expect(result.deps).toMatchObject({ mode: 'installed', ok: true, cmd: ['pnpm', 'install', '--frozen-lockfile'] });
  expect(calls).toEqual([{ args: ['install', '--frozen-lockfile'], cwd: result.base }]);
  expect(await fs.readText(`${result.base}/pnpm-lock.yaml`)).toBe('old-lock');
});
test('missing installer yields an explicit failed dependency result', async () => {
  await fixture({ 'pnpm-lock.yaml': 'fixture' });
  const result = await createLiteSandbox(p, { git: 'git' }).prepare(project, 'missing');
  expect(result.deps.ok).toBe(false); expect(result.warnings).toContain('deps-install-failed');
});
test('archive errors are surfaced and incomplete sandbox directories are removed', async () => {
  await fs.writeText(`${project}/file`, 'uncommitted'); await git(['init', '-q']);
  const sandbox = createLiteSandbox(p, bins);
  await expect(sandbox.prepare(project, 'empty')).rejects.toThrow('archive');
  expect(await fs.exists(`${p.dataDir}/runs/empty`)).toBe(false);
});
test('failed installer returns diagnostics and a failed dependency warning', async () => {
  await fixture({ 'pnpm-lock.yaml': 'fixture-lock' });
  const proc: Proc = { ...p.proc, async run(bin, args, opts) {
    if (bin === 'pnpm') return { code: 1, stdout: 'fixture output', stderr: 'fixture error' };
    return p.proc.run(bin, args, opts);
  } };
  const { deps, warnings } = await createLiteSandbox({ ...p, proc }, bins).prepare(project, 'failed');
  expect(deps).toMatchObject({ mode: 'installed', ok: false });
  expect(deps.log).toContain('fixture error');
  expect(warnings).toContain('deps-install-failed');
});
test('root source or data directory is rejected before sandbox writes', async () => {
  await expect(createLiteSandbox(p, bins).prepare('/', 'root')).rejects.toThrow('separate');
  await expect(createLiteSandbox({ ...p, dataDir: '/' }, bins).prepare(project, 'root')).rejects.toThrow('separate');
});
test('inherited GIT_DIR does not redirect sandbox git calls', async () => {
  await fixture();
  const seen: string[] = [];
  const spy: Platform = { ...p, proc: { ...p.proc, run: (bin, args, opts) => { seen.push(String(opts?.env?.GIT_DIR)); return p.proc.run(bin, args, opts); } } };
  await createLiteSandbox(spy, bins).prepare(project, 'envs');
  expect(seen.length).toBeGreaterThan(0);
  expect(seen).toContain('null');
});

test('prepares within the data directory without reading its parent', async () => {
  await fs.writeText(`${project}/main.txt`, 'source');
  await fs.mkdirp(p.dataDir);
  const scoped = { ...p, fs: { ...fs, async readDir(path: string) {
    if (path === root) throw new Error('outside filesystem scope');
    return fs.readDir(path);
  } } };
  const sandbox = createLiteSandbox(scoped, bins);
  const { base } = await sandbox.preparePreflight!(project, 'scoped');
  expect(await fs.readText(`${base}/main.txt`)).toBe('source');
  await sandbox.cleanup('scoped');
});
test('rejects a symlinked data directory', async () => {
  await fs.mkdirp(`${root}/actual-data`);
  await fs.symlink(`${root}/actual-data`, p.dataDir);
  await expect(createLiteSandbox(p, bins).preparePreflight!(project, 'linked-data')).rejects.toThrow('symlink');
  expect(await fs.exists(`${root}/actual-data/runs`)).toBe(false);
});
test('rejects a symlinked runs directory', async () => {
  await fs.mkdirp(p.dataDir);
  await fs.mkdirp(`${root}/outside`);
  await fs.symlink(`${root}/outside`, `${p.dataDir}/runs`);
  await expect(createLiteSandbox(p, bins).preparePreflight!(project, 'linked-runs')).rejects.toThrow('symlink');
  expect(await fs.exists(`${root}/outside/linked-runs`)).toBe(false);
});
test('prepares when direct filesystem access to git config is denied', async () => {
  await fs.writeText(`${project}/main.txt`, 'source');
  const scoped = { ...p, fs: { ...fs,
    async readText(path: string) { if (path.endsWith('/.git/config')) throw new Error('outside filesystem scope'); return fs.readText(path); },
    async writeText(path: string, text: string) { if (path.endsWith('/.git/config')) throw new Error('outside filesystem scope'); return fs.writeText(path, text); },
  } };
  const sandbox = createLiteSandbox(scoped, bins);
  const { base } = await sandbox.preparePreflight!(project, 'git-config-scope');
  await sandbox.prepareDependencies!(base);
  await sandbox.cleanup('git-config-scope');
});
test('does not overwrite a symlink target when restoring sandbox git config', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.preparePreflight!(project, 'config-link');
  const sentinel = `${root}/sentinel`;
  await fs.writeText(sentinel, 'preserve');
  await fs.remove(`${base}/.git/config`);
  await fs.symlink(sentinel, `${base}/.git/config`);
  await expect(sandbox.prepareDependencies!(base)).rejects.toThrow();
  expect(await fs.readText(sentinel)).toBe('preserve');
});
test('rejects a replaced sandbox git directory before restoring config', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.preparePreflight!(project, 'replaced-git');
  await fs.rename(`${base}/.git`, `${base}/original-git`);
  await fs.mkdirp(`${base}/.git`);
  await fs.writeText(`${base}/.git/config`, 'untouched');
  await expect(sandbox.prepareDependencies!(base)).rejects.toThrow('directory changed');
  expect(await fs.readText(`${base}/.git/config`)).toBe('untouched');
});
test('restores config before dependency commit can run included hooks or fsmonitor', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.preparePreflight!(project, 'poison-deps');
  const marker = `${root}/marker-deps`, script = await evilScript(marker);
  await fs.mkdirp(`${root}/hooks`);
  await fs.symlink(script, `${root}/hooks/pre-commit`);
  await fs.writeText(`${root}/included-config`, `[core]\n\thooksPath = ${root}/hooks\n\tfsmonitor = ${script}\n`);
  await fs.writeText(`${base}/.git/config`, `[include]\n\tpath = ${root}/included-config\n`);
  await sandbox.prepareDependencies!(base);
  expect(await fs.exists(marker)).toBe(false);
});
