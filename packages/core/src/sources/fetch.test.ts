import { afterEach, expect, test, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { nodeFs } from '../node/fs';
import { nodeProc } from '../node/proc';
import type { Platform } from '../platform';
import type { SkillMeta } from '../types';
import { createAgents } from '../agents';
import { hashFiles } from '../platform';
import { scanSkill } from '../scan';
import { fetchSkillFiles, readLocalSkill, createSampleSource } from './index';

const roots: string[] = [];
afterEach(async () => { for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(`${tmpdir()}/somm-source-`); roots.push(root);
  const p: Platform = { fs: nodeFs, proc: { ...nodeProc, run: vi.fn(nodeProc.run) },
    home: root, dataDir: `${root}/data`, env: {}, db: { async select() { return []; }, async execute() {} } };
  return { root, p };
}
async function git(args: string[], cwd?: string) {
  const result = await nodeProc.run('git', args, { cwd });
  if (result.code) throw new Error(result.stderr);
}
const meta = (repoUrl: string, path = 'skills/한글 skill'): SkillMeta => ({
  id: 'local', name: 'local', description: '', source: 'sample', repoUrl, ref: 'main', path, snapshots: [], agents: ['codex'],
});
test('sparse clone reads only requested path in bare repo with spaces/Korean and reuses cache', async () => {
  const { root, p } = await fixture();
  const work = `${root}/작업 repo`, bare = `${root}/원격 repo.git`;
  await p.fs.mkdirp(`${work}/skills/한글 skill/scripts`);
  await p.fs.writeText(`${work}/skills/한글 skill/SKILL.md`, '---\nname: "Real Name"\n---\n# Test');
  await p.fs.writeText(`${work}/skills/한글 skill/scripts/run.sh`, 'echo hi');
  await p.fs.writeText(`${work}/secret.txt`, 'not part of skill');
  await p.fs.symlink('../../../secret.txt', `${work}/skills/한글 skill/outside`);
  await git(['init', '-b', 'main', work]);
  await git(['add', '.'], work);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], work);
  await git(['clone', '--bare', work, bare]);
  const [first, concurrent] = await Promise.all([fetchSkillFiles(meta(bare), p, { allowLocal: true }), fetchSkillFiles(meta(bare), p, { allowLocal: true })]);
  expect(concurrent).toEqual(first);
  for (const [, , opts] of vi.mocked(p.proc.run).mock.calls) expect(opts?.env).toMatchObject({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' });
  expect(vi.mocked(p.proc.run).mock.calls.filter(([, args]) => args.includes('clone'))).toHaveLength(1);
  expect(first.map(f => f.path)).toEqual(['SKILL.md', 'scripts/run.sh']);
  const cacheDir = `${p.dataDir}/cache`;
  const firstGeneration = (await p.fs.readDir(cacheDir)).find(e => e.isDir)!.name;
  const cacheKey = firstGeneration.slice(0, 40);
  const oldStage = `${cacheDir}/${cacheKey}-${Date.now() - 700_000}-aaaaaaaaaaaaaaaa`;
  const youngStage = `${cacheDir}/${cacheKey}-${Date.now()}-bbbbbbbbbbbbbbbb`;
  await p.fs.mkdirp(oldStage);
  await p.fs.mkdirp(youngStage);
  await fetchSkillFiles(meta(bare), p, { refresh: true, allowLocal: true });
  expect(await p.fs.exists(oldStage)).toBe(false);
  expect(await p.fs.exists(youngStage)).toBe(true);
  expect(await p.fs.exists(`${cacheDir}/${firstGeneration}/.somm-ready`)).toBe(true);
  const callsAfterRefresh = vi.mocked(p.proc.run).mock.calls.length;
  expect(await fetchSkillFiles(meta(bare), p, { allowLocal: true })).toEqual(first);
  expect(vi.mocked(p.proc.run).mock.calls).toHaveLength(callsAfterRefresh);
  expect((await readLocalSkill(`${work}/skills/한글 skill`, p)).name).toBe('Real Name');
  await p.fs.writeText(`${work}/skills/한글 skill/SKILL.md`, '# No metadata');
  expect((await readLocalSkill(`${work}/skills/한글 skill/`, p)).name).toBe('한글 skill');
  expect(await p.fs.readText(`${work}/secret.txt`)).toBe('not part of skill');
});
test('rejects traversal, git option injection and unsafe transport before spawning', async () => {
  const { p } = await fixture();
  for (const path of ['../outside', '/absolute', 'a/../../escape', '.git', 'a/.git', '-option', 'a\\b']) {
    await expect(fetchSkillFiles(meta('https://example.invalid/repo', path), p)).rejects.toThrow();
  }
  for (const repo of ['--upload-pack=bad', 'ext::command']) await expect(fetchSkillFiles(meta(repo), p)).rejects.toThrow();
  await expect(fetchSkillFiles({ ...meta('/tmp/repo'), ref: '--bad' }, p)).rejects.toThrow();
  expect(p.proc.run).not.toHaveBeenCalled();
});
test('failed clones are never cached and retry succeeds in invoking clone again', async () => {
  const { p } = await fixture();
  p.proc.run = vi.fn(async () => ({ code: 1, stdout: '', stderr: 'failed' }));
  await expect(fetchSkillFiles(meta('/tmp/missing-repo'), p, { allowLocal: true })).rejects.toThrow();
  await expect(fetchSkillFiles(meta('/tmp/missing-repo'), p, { allowLocal: true })).rejects.toThrow();
  expect(p.proc.run).toHaveBeenCalledTimes(2);
});
test('local skill skips .git and symlinks and requires a regular SKILL.md', async () => {
  const { root, p } = await fixture();
  await p.fs.mkdirp(`${root}/local/.git`);
  await p.fs.writeText(`${root}/local/.git/config`, 'private');
  await p.fs.writeText(`${root}/local/SKILL.md`, '---\nname: 123\n---\n');
  await p.fs.symlink('SKILL.md', `${root}/local/link`);
  expect(await readLocalSkill(`${root}/local`, p)).toEqual({ name: 'local', files: [{ path: 'SKILL.md', contents: '---\nname: 123\n---\n' }] });
  await expect(readLocalSkill(root, p)).rejects.toThrow('SKILL.md');
});
test('sample source returns independent metadata with ten demo snapshots and Codex entries', async () => {
  const source = createSampleSource();
  const items = await source.fetchIndex();
  expect(source.id).toBe('sample');
  expect(items.length).toBeGreaterThanOrEqual(20);
  expect(items.every(i => i.snapshots.length === 10)).toBe(true);
  expect(items.some(i => i.agents.includes('codex'))).toBe(true);
  items[0].snapshots.length = 0;
  expect((await source.fetchIndex())[0].snapshots).toHaveLength(10);
});
test('root skills support pinned commits without including .git internals', async () => {
  const { root, p } = await fixture();
  const work = `${root}/repo`;
  await p.fs.mkdirp(`${work}/references`);
  await p.fs.writeText(`${work}/SKILL.md`, '# Root');
  await p.fs.writeText(`${work}/references/guide.md`, '# Reference');
  await git(['init', '-b', 'main', work]);
  await git(['add', '.'], work);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], work);
  const ref = (await nodeProc.run('git', ['rev-parse', 'HEAD'], { cwd: work })).stdout.trim();
  const files = await fetchSkillFiles({ ...meta(work, '.'), ref }, p, { allowLocal: true });
  expect(files.map(f => f.path)).toEqual(['SKILL.md', 'references/guide.md']);
});
test('preserves binary assets and rejects symlink path components', async () => {
  const { root, p } = await fixture();
  const work = `${root}/repo`;
  await p.fs.mkdirp(`${work}/real`);
  await p.fs.writeText(`${work}/real/SKILL.md`, '# Skill');
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1cAAAAASUVORK5CYII=', 'base64'));
  await p.fs.writeBytes(`${work}/real/image.png`, png);
  await p.fs.symlink('real', `${work}/linked`);
  await git(['init', '-b', 'main', work]);
  await git(['add', '.'], work);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'], work);
  const files = await fetchSkillFiles(meta(work, 'real'), p, { allowLocal: true });
  expect(files.find(f => f.path === 'image.png')?.contents).toEqual(png);
  const installed = await createAgents(p).codex.install({ name: 'binary', source: 'test', files }, 'global', { mode: 'copy' });
  expect(await p.fs.readBytes(`${installed.dir}/image.png`)).toEqual(png);
  expect(installed.hash).toBe(await hashFiles(files));
  expect(scanSkill(files, { name: 'binary' }).findings).toContainEqual(expect.objectContaining({ ruleId: 'unscannable-asset', severity: 'medium' }));
  const changed = files.map(f => f.path === 'image.png' ? { ...f, contents: new Uint8Array([0, 255]) } : f);
  expect(await hashFiles(changed)).not.toBe(installed.hash);
  await p.fs.writeText(`${work}/real/SKILL.md`, '# Updated');
  await git(['add', '.'], work);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'update'], work);
  expect(await fetchSkillFiles(meta(work, 'real'), p, { allowLocal: true })).toEqual(files);
  expect((await fetchSkillFiles(meta(work, 'real'), p, { refresh: true, allowLocal: true })).find(f => f.path === 'SKILL.md')?.contents).toBe('# Updated');
  await expect(fetchSkillFiles(meta(work, 'linked'), p, { allowLocal: true })).rejects.toThrow('symlink');
  expect((await p.fs.readDir(`${p.dataDir}/cache`)).filter(e => e.isDir)).toHaveLength(2);
  expect(await p.fs.readText(`${work}/real/SKILL.md`)).toBe('# Updated');
  const other: Platform = { ...p };
  await Promise.all([fetchSkillFiles(meta(work, 'real'), p, { refresh: true, allowLocal: true }), fetchSkillFiles(meta(work, 'real'), other, { refresh: true, allowLocal: true })]);
  expect((await fetchSkillFiles(meta(work, 'real'), other, { allowLocal: true })).find(f => f.path === 'SKILL.md')?.contents).toBe('# Updated');
  const rename = p.fs.rename;
  const denied: Platform = { ...p, fs: { ...p.fs, async rename(from, to) {
    if (to.endsWith('.somm-ready')) throw new Error('publish denied');
    await rename(from, to);
  } } };
  await expect(fetchSkillFiles(meta(work, 'real'), denied, { refresh: true, allowLocal: true })).rejects.toThrow('publish denied');
  expect((await fetchSkillFiles(meta(work, 'real'), other, { allowLocal: true })).find(f => f.path === 'SKILL.md')?.contents).toBe('# Updated');

});

test('cache identity separates ambiguous ref/path concatenations', async () => {
  const { p } = await fixture();
  p.proc.run = vi.fn(async () => ({ code: 1, stdout: '', stderr: '' }));
  for (const [ref, path] of [['ab', 'c'], ['a', 'bc']]) {
    await expect(fetchSkillFiles({ ...meta('/tmp/repo', path), ref }, p, { allowLocal: true })).rejects.toThrow();
  }
  const keys = vi.mocked(p.proc.run).mock.calls.map(([, args]) => args.at(-1)!.match(/\/([a-f0-9]{40})-\d{13}-/)![1]);
  expect(new Set(keys).size).toBe(2);
});
test('waiting refresh runs after failed request rather than inheriting its failure', async () => {
  const { p } = await fixture();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  p.proc.run = vi.fn(async () => { await barrier; return { code: 1, stdout: '', stderr: '' }; });
  const first = fetchSkillFiles(meta('/tmp/missing'), p, { allowLocal: true });
  const refreshed = fetchSkillFiles(meta('/tmp/missing'), p, { refresh: true, allowLocal: true });
  const checks = Promise.all([expect(first).rejects.toThrow(), expect(refreshed).rejects.toThrow()]);
  release();
  await checks;
  expect(p.proc.run).toHaveBeenCalledTimes(2);
});

test('older refresh finishing last never replaces a newer published generation', async () => {
  const { root, p } = await fixture();
  const work = `${root}/repo`;
  const commit = async (text: string) => {
    await p.fs.writeText(`${work}/SKILL.md`, text);
    await git(['add', '.'], work);
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', text], work);
  };
  await p.fs.mkdirp(work);
  await git(['init', '-b', 'main', work]);
  await commit('v1');
  const read = async (q: Platform) => (await fetchSkillFiles(meta(work, '.'), q, { allowLocal: true })).find(f => f.path === 'SKILL.md')?.contents;
  expect(await read(p)).toBe('v1');
  let release!: () => void, blocked!: () => void;
  const barrier = new Promise<void>(r => { release = r; }), reached = new Promise<void>(r => { blocked = r; });
  const slow: Platform = { ...p, proc: { ...p.proc, async run(bin, args, opts) {
    if (args.includes('checkout')) { blocked(); await barrier; }
    return nodeProc.run(bin, args, opts);
  } } };
  const older = fetchSkillFiles(meta(work, '.'), slow, { refresh: true, allowLocal: true });
  await reached;
  await commit('v2');
  const fresh: Platform = { ...p };
  expect(await read(fresh)).toBe('v1'); // reader during an unpublished stage sees a complete generation
  const failing: Platform = { ...p, proc: { ...p.proc, run: async () => ({ code: 1, stdout: '', stderr: '' }) } };
  await expect(fetchSkillFiles(meta(work, '.'), failing, { refresh: true, allowLocal: true })).rejects.toThrow();
  expect((await fetchSkillFiles(meta(work, '.'), { ...p }, { refresh: true, allowLocal: true })).find(f => f.path === 'SKILL.md')?.contents).toBe('v2');
  release();
  expect((await older).find(f => f.path === 'SKILL.md')?.contents).toBe('v1');
  expect(await read({ ...p })).toBe('v2');
});

test('rejects local repositories by default before invoking git', async () => {
  const { p } = await fixture();
  await expect(fetchSkillFiles(meta('/tmp/untrusted'), p)).rejects.toThrow('Unsupported repository URL');
  expect(p.proc.run).not.toHaveBeenCalled();
});

test('limits raw file and cumulative bytes, preserving boundary binary data', async () => {
  const { root, p } = await fixture();
  const dir = `${root}/limit`;
  await p.fs.mkdirp(`${dir}/nested`);
  await p.fs.writeText(`${dir}/SKILL.md`, 'x');
  const binary = new Uint8Array(1024 * 1024); binary[0] = 255;
  await p.fs.writeBytes(`${dir}/nested/asset`, binary);
  expect((await readLocalSkill(dir, p)).files.find(f => f.path === 'nested/asset')?.contents).toEqual(binary);
  const read = vi.fn(p.fs.readBytes);
  const tracked = { ...p, fs: { ...p.fs, readBytes: read } };
  await p.fs.writeBytes(`${dir}/nested/asset`, new Uint8Array(1024 * 1024 + 1));
  await expect(readLocalSkill(dir, tracked)).rejects.toThrow('file size limit');
  expect(read.mock.calls.some(([path]) => path.endsWith('/asset'))).toBe(false);
  await p.fs.writeBytes(`${dir}/nested/asset`, binary);
  for (let i = 0; i < 9; i++) await p.fs.writeBytes(`${dir}/nested/${i}`, binary);
  await expect(readLocalSkill(dir, p)).rejects.toThrow('total size limit');
  await p.fs.writeText(`${dir}/SKILL.md`, '');
  expect((await readLocalSkill(dir, p)).files).toHaveLength(11);
});

test('oversized refresh keeps the previously published cache', async () => {
  const { root, p } = await fixture();
  const work = `${root}/repo`;
  await p.fs.mkdirp(work);
  await p.fs.writeText(`${work}/SKILL.md`, '# original');
  await git(['init', '-b', 'main', work]);
  await git(['add', '.'], work);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'initial'], work);
  const original = await fetchSkillFiles(meta(work, '.'), p, { allowLocal: true });
  await p.fs.writeBytes(`${work}/large`, new Uint8Array(1024 * 1024 + 1));
  await git(['add', '.'], work);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'large'], work);
  await expect(fetchSkillFiles(meta(work, '.'), p, { refresh: true, allowLocal: true })).rejects.toThrow('file size limit');
  expect(await fetchSkillFiles(meta(work, '.'), p, { allowLocal: true })).toEqual(original);
  expect((await p.fs.readDir(`${p.dataDir}/cache`)).filter(e => e.isDir)).toHaveLength(1);
});

test('checks actual bytes when a file grows after its size was read', async () => {
  const { root, p } = await fixture();
  await p.fs.writeText(`${root}/SKILL.md`, '# skill');
  const changed: Platform = { ...p, fs: { ...p.fs, async readBytes() { return new Uint8Array(1024 * 1024 + 1); } } };
  await expect(readLocalSkill(root, changed)).rejects.toThrow('file size limit');
});

test('checks actual cumulative bytes when the final file grows after stat', async () => {
  const { p } = await fixture();
  const names = ['SKILL.md', ...Array.from({ length: 10 }, (_, i) => `asset${i}`)];
  const readBytes = vi.fn(async (path: string) => path.endsWith('SKILL.md')
    ? new TextEncoder().encode('x') : new Uint8Array(1024 * 1024));
  const changed: Platform = { ...p, fs: { ...p.fs,
    async readDir() { return names.map(name => ({ name, isDir: false, isSymlink: false })); },
    async fileSize(path) { return path.endsWith('SKILL.md') ? 1 : path.endsWith('asset9') ? 0 : 1024 * 1024; },
    readBytes,
  } };
  await expect(readLocalSkill('/skill', changed)).rejects.toThrow('total size limit');
  expect(readBytes).toHaveBeenLastCalledWith('/skill/asset9');
});
