import { expect, test } from 'vitest';
import { nodeFs as fs } from '../node/fs';
import { nodeProc } from '../node/proc';
import { createLiteSandbox, SANDBOX_GIT_ENV } from './lite';
import { root, project, p, bins, git, fixture, setProject } from './lite-test-helpers';
async function linkRejected(link: (real: string) => string | Promise<string>, extra?: (dir: string) => Promise<void>) {
  await fixture({ 'pnpm-lock.yaml': 'lock' });
  const real = (await p.proc.run('pwd', ['-P'], { cwd: project })).stdout.trim();
  await fs.mkdirp(`${project}/node_modules`);
  await extra?.(`${project}/node_modules`);
  await fs.symlink(await link(real), `${project}/node_modules/escape`);
  const { deps } = await createLiteSandbox(p, { git: 'git' }).prepare(project, 'lnk');
  expect(deps.mode).not.toBe('cloned');
}
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
test('dependency symlink into a project reached through a symlinked parent is rejected', async () => {
  const real = `${root}/real`, alias = `${root}/alias`;
  await fs.mkdirp(real); await fs.symlink(real, alias);
  const aliased = `${alias}/proj`;
  await fs.mkdirp(aliased);
  setProject(aliased);
  await fixture({ 'pnpm-lock.yaml': 'lock' });
  await fs.mkdirp(`${real}/proj/node_modules`);
  await fs.symlink(`${real}/proj/main.txt`, `${real}/proj/node_modules/escape`);
  const { deps } = await createLiteSandbox(p, { git: 'git' }).prepare(aliased, 'alias');
  expect(deps.mode).not.toBe('cloned');
});
test('rejects a link that continues through an earlier absolute hop', () => linkRejected(
  () => 'a/../../공백 한글 프로젝트/main.txt',
  async dir => { await fs.mkdirp(`${root}/outside/sub`); await fs.symlink(`${root}/outside/sub`, `${dir}/a`); }));
test('rejects dependency links using different case', () => linkRejected(real => `${real.toUpperCase()}/main.txt`));
test('rejects dependency links through the macOS data firmlink', () => linkRejected(real => `/System/Volumes/Data${real}/main.txt`));

