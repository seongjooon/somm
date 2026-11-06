import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeFs as fs } from '../node/fs';
import { nodeProc } from '../node/proc';
import type { Platform, Proc } from '../platform';
import { createLiteSandbox, SANDBOX_GIT_ENV } from './lite';
let root: string, project: string, p: Platform;
const bins = { git: 'git', pnpm: 'pnpm' };
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'somm-sandbox-'));
  project = `${root}/공백 한글 프로젝트`;
  await fs.mkdirp(project);
  await fs.mkdirp(`${root}/empty-home`);
  p = { fs, proc: { ...nodeProc, run: (bin, args, opts) => nodeProc.run(bin, args,
    { ...opts, env: { HOME: `${root}/empty-home`, GIT_CONFIG_NOSYSTEM: '1', ...opts?.env } }) },
  home: `${root}/empty-home`, dataDir: `${root}/data`, env: {},
  db: { async select() { return []; }, async execute() {} } };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function git(args: string[], cwd = project) {
  const result = await p.proc.run('git', args, { cwd, env: SANDBOX_GIT_ENV });
  expect(result.code, result.stderr).toBe(0);
  return result.stdout.trim();
}
async function fixture(extra: Record<string, string> = {}) {
  await fs.writeText(`${project}/main.txt`, 'old\nkeep\n');
  for (const [file, contents] of Object.entries(extra)) await fs.writeText(`${project}/${file}`, contents);
  await git(['init', '-q']); await git(['add', '-A']); await git(['commit', '-qm', 'fixture']);
}
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
test('clones root and workspace dependencies, splits independent copies, and collects full diff', async () => {
  await fixture({ 'pnpm-lock.yaml': 'fixture lock' });
  for (const dir of ['node_modules/x', 'packages/a/node_modules/x']) {
    await fs.mkdirp(`${project}/${dir}`); await fs.writeText(`${project}/${dir}/index.js`, 'original');
  }
  const sandbox = createLiteSandbox(p, bins);
  const { base, deps } = await sandbox.prepare(project, 'clone'); expect(deps.mode).toBe('cloned');
  expect(await fs.readText(`${base}/packages/a/node_modules/x/index.js`)).toBe('original');
  expect(await git(['status', '--porcelain'], base)).toBe('');
  const arms = await sandbox.split(base, ['a-0', 'b-0']);
  await fs.writeText(`${arms['a-0']}/main.txt`, 'new\nextra\nkeep\n');
  await fs.writeText(`${arms['a-0']}/node_modules/x/index.js`, 'changed');
  expect(await fs.readText(`${arms['b-0']}/main.txt`)).toBe('old\nkeep\n');
  expect(await fs.readText(`${project}/node_modules/x/index.js`)).toBe('original');
  expect(await sandbox.diffStat(arms['a-0'])).toMatchObject({ files: 1, added: 2, removed: 1 });
  await fs.writeText(`${arms['a-0']}/new.txt`, 'fresh\n');
  expect(await sandbox.diffStat(arms['a-0'])).toMatchObject({ files: 2, added: 3, removed: 1 });
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
test('canaries are unique, limited to disposable directories and never overwrite files', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'canary');
  const arms = await sandbox.split(base, ['a', 'b']);
  const a = await sandbox.plantCanaries({ projectDir: arms.a, homeDir: `${p.dataDir}/runs/canary/home` });
  const b = await sandbox.plantCanaries({ projectDir: arms.b });
  expect(a).toHaveLength(5); expect(b).toHaveLength(2);
  expect(new Set([...a, ...b].map(c => c.token)).size).toBe(7);
  for (const c of [...a, ...b]) {
    expect(c.token).toMatch(/^somm-canary-[a-f0-9]{16}$/);
    expect(await fs.readText(c.path)).toContain(c.token);
  }
  await expect(sandbox.plantCanaries({ projectDir: project })).rejects.toThrow('outside sandbox');
  await expect(sandbox.plantCanaries({ projectDir: arms.a })).rejects.toThrow('Canary collision');
  expect(await fs.exists(`${project}/.env`)).toBe(false);
});
test('rejects traversal, duplicate runs, arm collisions, and canary symlink escapes', async () => {
  await fixture(); const sandbox = createLiteSandbox(p, bins);
  await expect(sandbox.prepare(project, '../escape')).rejects.toThrow('identifier');
  const { base } = await sandbox.prepare(project, 'safe');
  await expect(sandbox.prepare(project, 'safe')).rejects.toThrow('already exists');
  await expect(sandbox.split(base, ['base'])).rejects.toThrow('arms');
  await expect(sandbox.split(base, ['../escape'])).rejects.toThrow('identifier');
  await fs.symlink(project, `${base}/config`);
  await expect(sandbox.plantCanaries({ projectDir: base })).rejects.toThrow('symlink');
  expect(await fs.exists(`${project}/secrets.local.json`)).toBe(false);
});
test('archive errors are surfaced and incomplete sandbox directories are removed', async () => {
  await fs.writeText(`${project}/file`, 'uncommitted'); await git(['init', '-q']);
  const sandbox = createLiteSandbox(p, bins);
  await expect(sandbox.prepare(project, 'empty')).rejects.toThrow('archive');
  expect(await fs.exists(`${p.dataDir}/runs/empty`)).toBe(false);
});
test('falls back to regular copies and exposes the warning even when splitting', async () => {
  await fixture();
  const proc: Proc = { ...p.proc, async run(bin, args, opts) {
    if (bin === 'cp' && args[0] === '-cR') return { code: 1, stdout: '', stderr: 'clone unsupported' };
    return p.proc.run(bin, args, opts);
  } };
  const sandbox = createLiteSandbox({ ...p, proc }, bins);
  const { base, warnings } = await sandbox.prepare(project, 'fallback');
  expect(warnings).not.toContain('slow-copy');
  const arms = await sandbox.split(base, ['a']);
  expect(warnings).toContain('slow-copy');
  expect(await fs.readText(`${arms.a}/main.txt`)).toBe('old\nkeep\n');
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
test('rejects dependency links back to the original project and never changes their target', async () => {
  await fixture({ 'pnpm-lock.yaml': 'fixture-lock' });
  await fs.mkdirp(`${project}/node_modules`);
  await fs.symlink(`${project}/main.txt`, `${project}/node_modules/escape`);
  const { base, deps } = await createLiteSandbox(p, { git: 'git' }).prepare(project, 'links');
  expect(deps).toMatchObject({ mode: 'none', ok: false });
  expect(await fs.exists(`${base}/node_modules/escape`)).toBe(false);
  expect(await fs.readText(`${project}/main.txt`)).toBe('old\nkeep\n');
});
test('removes all secret filename patterns recursively while preserving examples', async () => {
  await fs.mkdirp(`${project}/nested`);
  await fixture();
  const secrets = ['.env.local', 'cert.pem', 'server.key', 'id_rsa.pub', '.pypirc'];
  for (const file of [...secrets, '.env.example']) await fs.writeText(`${project}/nested/${file}`, 'fake only');
  await git(['add', '-A']); await git(['commit', '-qm', 'nested fixtures']);
  const { base, warnings } = await createLiteSandbox(p, bins).prepare(project, 'secrets');
  for (const file of secrets) expect(await fs.exists(`${base}/nested/${file}`)).toBe(false);
  expect(await fs.exists(`${base}/nested/.env.example`)).toBe(true);
  expect(warnings.filter(x => x === 'secrets-removed')).toHaveLength(1);
});
test('baseline includes archived files even when source gitignore would normally hide them', async () => {
  await fixture({ '.gitignore': 'main.txt\n' });
  // fixture() uses a normal add; force-add the intentionally ignored source file.
  await git(['add', '-f', 'main.txt']); await git(['commit', '-qm', 'force tracked source']);
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'ignored');
  const arms = await sandbox.split(base, ['a']);
  await fs.writeText(`${arms.a}/main.txt`, 'changed\n');
  expect(await sandbox.diffStat(arms.a)).toMatchObject({ files: 1, added: 1, removed: 2 });
});
test('rejects data directory overlap through a symlink alias before writing', async () => {
  await fixture(); await fs.symlink(project, `${root}/alias`);
  await expect(createLiteSandbox({ ...p, dataDir: `${root}/alias/data` }, bins).prepare(project, 'alias'))
    .rejects.toThrow('separate');
  expect(await fs.exists(`${project}/data`)).toBe(false);
});
test('scrubs secrets copied inside dependencies without changing source dependencies', async () => {
  await fixture(); await fs.mkdirp(`${project}/node_modules/x`);
  await fs.writeText(`${project}/node_modules/x/.env`, 'fake-dependency-secret');
  const { base, warnings } = await createLiteSandbox(p, bins).prepare(project, 'dep-secret');
  expect(await fs.exists(`${base}/node_modules/x/.env`)).toBe(false);
  expect(await fs.readText(`${project}/node_modules/x/.env`)).toBe('fake-dependency-secret');
  expect(warnings).toContain('secrets-removed');
});
test('preserves usable relative dependency links and valid fixed-path JSON canaries', async () => {
  await fixture(); await fs.mkdirp(`${project}/node_modules/.pnpm/x`);
  await fs.writeText(`${project}/node_modules/.pnpm/x/index.js`, 'usable');
  await fs.symlink('.pnpm/x', `${project}/node_modules/x`);
  const sandbox = createLiteSandbox(p, bins);
  const { base, deps } = await sandbox.prepare(project, 'relative');
  expect(deps.ok).toBe(true);
  expect(await fs.readText(`${base}/node_modules/x/index.js`)).toBe('usable');
  const canaries = await sandbox.plantCanaries({ projectDir: base });
  const json = canaries.find(c => c.path.endsWith('.json'))!;
  expect(JSON.parse(await fs.readText(json.path))).toEqual({ token: json.token });
});
test('root source or data directory is rejected before sandbox writes', async () => {
  await expect(createLiteSandbox(p, bins).prepare('/', 'root')).rejects.toThrow('separate');
  await expect(createLiteSandbox({ ...p, dataDir: '/' }, bins).prepare(project, 'root')).rejects.toThrow('separate');
});
test('fixed-path canary collision preserves existing data and writes no partial canaries', async () => {
  await fixture(); const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'collision');
  await fs.mkdirp(`${base}/config`);
  await fs.writeText(`${base}/config/secrets.local.json`, '{"existing":"fixture"}');
  await expect(sandbox.plantCanaries({ projectDir: base })).rejects.toThrow('Canary collision');
  expect(await fs.exists(`${base}/.env`)).toBe(false);
  expect(await fs.readText(`${base}/config/secrets.local.json`)).toBe('{"existing":"fixture"}');
});
test('rejects chained relative links whose dotdot traversal escapes base', async () => {
  await fixture(); await fs.mkdirp(`${project}/node_modules/x`);
  await fs.symlink('../..', `${project}/node_modules/x/up`);
  await fs.symlink('x/up/../../outside', `${project}/node_modules/escape`);
  const { base, deps, warnings } = await createLiteSandbox(p, bins).prepare(project, 'chain');
  expect(deps.ok).toBe(false);
  expect(deps.log).toContain('cloning failed');
  expect(warnings).toContain('deps-install-failed');
  expect(await fs.exists(`${base}/node_modules`)).toBe(false);
  expect(await fs.readlink(`${project}/node_modules/escape`)).toBe('x/up/../../outside');
});
test('unresolved dependency links fail without a lockfile instead of reporting success', async () => {
  await fixture(); await fs.mkdirp(`${project}/node_modules`);
  await fs.symlink('missing', `${project}/node_modules/broken`);
  const { deps } = await createLiteSandbox(p, bins).prepare(project, 'broken');
  expect(deps).toMatchObject({ mode: 'none', ok: false });
  expect(await fs.readlink(`${project}/node_modules/broken`)).toBe('missing');
});
test('rejects external links hidden inside nested dependency git directories', async () => {
  await fixture();
  await fs.mkdirp(`${project}/node_modules/pkg/.git`);
  await fs.writeText(`${project}/node_modules/pkg/.git/.env`, 'fake-nested-secret');
  await fs.symlink(project, `${project}/node_modules/pkg/.git/escape`);
  const { base, deps } = await createLiteSandbox(p, bins).prepare(project, 'nested-git');
  expect(deps.ok).toBe(false);
  expect(await fs.exists(`${base}/node_modules`)).toBe(false);
  expect(await fs.readText(`${project}/node_modules/pkg/.git/.env`)).toBe('fake-nested-secret');
  expect(await fs.readlink(`${project}/node_modules/pkg/.git/escape`)).toBe(project);
});
test('rejects chained escapes inside nested git directories', async () => {
  await fixture(); await fs.mkdirp(`${project}/node_modules/pkg/.git`);
  await fs.symlink('../../..', `${project}/node_modules/pkg/.git/up`);
  await fs.symlink('up/../../outside', `${project}/node_modules/pkg/.git/escape`);
  const { deps } = await createLiteSandbox(p, bins).prepare(project, 'nested-chain');
  expect(deps.ok).toBe(false);
  expect(await fs.readlink(`${project}/node_modules/pkg/.git/escape`)).toBe('up/../../outside');
});
test('scrubs nested git secrets while preserving safe relative dependency links', async () => {
  await fixture(); await fs.mkdirp(`${project}/node_modules/pkg/.git`);
  await fs.writeText(`${project}/node_modules/pkg/.git/.env`, 'fake-secret');
  await fs.writeText(`${project}/node_modules/pkg/index.js`, 'usable');
  await fs.symlink('../index.js', `${project}/node_modules/pkg/.git/safe`);
  const { base, deps } = await createLiteSandbox(p, bins).prepare(project, 'nested-safe');
  expect(deps.ok).toBe(true);
  expect(await fs.exists(`${base}/node_modules/pkg/.git/.env`)).toBe(false);
  expect(await fs.readText(`${base}/node_modules/pkg/.git/safe`)).toBe('usable');
  expect(await fs.readText(`${project}/node_modules/pkg/.git/.env`)).toBe('fake-secret');
});
test('agent-controlled arm git config and attributes never execute during diffStat', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'gitcfg');
  const arms = await sandbox.split(base, ['a']);
  const marker = `${root}/pwned`, script = `${root}/evil.sh`;
  await fs.writeText(script, `#!/bin/sh\ntouch '${marker}'\ncat\n`);
  expect((await p.proc.run('chmod', ['+x', script])).code).toBe(0);
  await fs.writeText(`${arms.a}/.git/config`, `[core]\n\tfsmonitor = ${script}\n[filter "x"]\n\tclean = ${script}\n[diff "x"]\n\ttextconv = ${script}\n`);
  await fs.writeText(`${arms.a}/.gitattributes`, '* filter=x diff=x\n');
  await fs.writeText(`${arms.a}/.git/info/attributes`, '* filter=x diff=x\n');
  await fs.writeText(`${arms.a}/main.txt`, 'changed\n');
  await sandbox.diffStat(arms.a);
  expect(await fs.exists(marker)).toBe(false);
});
test('prepare never writes to the source repository index', async () => {
  await fixture();
  const future = new Date(Date.now() + 60_000);
  await utimes(`${project}/main.txt`, future, future);
  const before = (await stat(`${project}/.git/index`)).mtimeMs;
  await createLiteSandbox(p, bins).prepare(project, 'locks');
  expect((await stat(`${project}/.git/index`)).mtimeMs).toBe(before);
});
test('process env overrides merge with the inherited environment', async () => {
  const result = await nodeProc.run('sh', ['-c', 'printf %s "$PATH"'], { env: SANDBOX_GIT_ENV });
  expect(result.stdout).toBe(process.env.PATH);
});
test('preserves absolute dependency links outside the project and home', async () => {
  await fixture(); await fs.mkdirp(`${project}/.venv/bin`);
  await fs.symlink('/usr/bin/python3', `${project}/.venv/bin/python`);
  const { base, deps } = await createLiteSandbox(p, bins).prepare(project, 'venv');
  expect(deps.ok).toBe(true);
  expect(await fs.readlink(`${base}/.venv/bin/python`)).toBe('/usr/bin/python3');
});
test('rejects absolute dependency links into the home directory', async () => {
  await fixture(); await fs.mkdirp(`${project}/.venv/bin`);
  await fs.symlink(`${p.home}/x`, `${project}/.venv/bin/python`);
  const { deps } = await createLiteSandbox(p, bins).prepare(project, 'venv-home');
  expect(deps.ok).toBe(false);
});
async function evilScript(marker: string) {
  const script = `${root}/evil2.sh`;
  await fs.writeText(script, `#!/bin/sh\ntouch '${marker}'\ncat\n`);
  expect((await p.proc.run('chmod', ['+x', script])).code).toBe(0);
  return script;
}
test('arm git config fsmonitor and attribute filters leave no marker files', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'hard1');
  const arms = await sandbox.split(base, ['a']);
  const marker = `${root}/marker1`, script = await evilScript(marker);
  await fs.writeText(`${arms.a}/.git/config`, `[core]\n\tfsmonitor = ${script}\n[filter "x"]\n\tclean = ${script}\n`);
  await fs.writeText(`${arms.a}/.gitattributes`, '* filter=x\n');
  await fs.writeText(`${arms.a}/main.txt`, 'changed\n');
  await sandbox.diffStat(arms.a);
  expect(await fs.exists(marker)).toBe(false);
});
test('arm commondir and alternates do not change the diff or reach outside', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'hard2');
  const arms = await sandbox.split(base, ['a']);
  await fs.writeText(`${arms.a}/main.txt`, 'changed\n');
  const expected = await sandbox.diffStat(arms.a);
  await fs.writeText(`${arms.a}/.git/commondir`, `${project}/.git\n`);
  await fs.mkdirp(`${arms.a}/.git/objects/info`);
  await fs.writeText(`${arms.a}/.git/objects/info/alternates`, `${project}/.git/objects\n`);
  const before = (await stat(`${project}/.git/index`)).mtimeMs;
  expect(await sandbox.diffStat(arms.a)).toEqual(expected);
  expect((await stat(`${project}/.git/index`)).mtimeMs).toBe(before);
});
test('user-level git config filters are not applied during diffStat', async () => {
  await fixture();
  const sandbox = createLiteSandbox(p, bins);
  const { base } = await sandbox.prepare(project, 'hard3');
  const arms = await sandbox.split(base, ['a']);
  const marker = `${root}/marker3`, script = await evilScript(marker);
  await fs.writeText(`${root}/empty-home/.gitconfig`, `[filter "x"]\n\tclean = ${script}\n`);
  await fs.writeText(`${arms.a}/.gitattributes`, '* filter=x\n');
  await fs.writeText(`${arms.a}/main.txt`, 'changed\n');
  await sandbox.diffStat(arms.a);
  expect(await fs.exists(marker)).toBe(false);
});
// Accepted limitation: an arm .gitignore can hide its own changes from the diff (ignored files are not force-added).
test('dependency symlink into a project reached through a symlinked parent is rejected', async () => {
  const real = `${root}/real`, alias = `${root}/alias`;
  await fs.mkdirp(real); await fs.symlink(real, alias);
  const aliased = `${alias}/proj`;
  await fs.mkdirp(aliased);
  project = aliased;
  await fixture({ 'pnpm-lock.yaml': 'lock' });
  await fs.mkdirp(`${real}/proj/node_modules`);
  await fs.symlink(`${real}/proj/main.txt`, `${real}/proj/node_modules/escape`);
  const { deps } = await createLiteSandbox(p, { git: 'git' }).prepare(aliased, 'alias');
  expect(deps.mode).not.toBe('cloned');
});
