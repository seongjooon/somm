import { expect, test } from 'vitest';
import { createAgents, SkillExistsError, SkillMoveRecoveryError } from './index';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { nodeFs } from '../node/fs';
import { nodeProc } from '../node/proc';
import { migrate, type Platform } from '../platform';

async function testPlatform() {
  const home = await mkdtemp(`${tmpdir()}/somm-agents-`);
  const database = new DatabaseSync(':memory:');
  const p: Platform = { home, dataDir: `${home}/data`, env: {}, fs: nodeFs, proc: nodeProc,
    db: {
      async select<T>(sql: string, params: unknown[] = []) { return database.prepare(sql).all(...params as SQLInputValue[]) as T[]; },
      async execute(sql, params = []) { database.prepare(sql).run(...params as SQLInputValue[]); },
    },
  };
  await migrate(p.db);
  return { p, async cleanup() { database.close(); await rm(home, { recursive: true, force: true }); } };
}

const skill = { name: 'sample', source: 'sample:one', files: [{ path: 'SKILL.md', contents: '# Sample' }, { path: 'scripts/run.sh', contents: 'echo hi' }] };
test('copy, reject existing, backup overwrite, disable/enable and uninstall', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    const a = createAgents(p).claude;
    const item = await a.install(skill, 'global', { mode: 'copy' });
    expect(item).toMatchObject({ managedBySomm: true, enabled: true, isSymlink: false });
    expect(await p.fs.readText(`${item.dir}/scripts/run.sh`)).toBe('echo hi');
    expect(JSON.parse(await p.fs.readText(`${item.dir}/.somm.json`))).toMatchObject({ source: skill.source, hash: item.hash, installedAt: expect.any(String) });
    await expect(a.install(skill, 'global', { mode: 'copy' })).rejects.toBeInstanceOf(SkillExistsError);
    expect(await p.fs.readText(`${item.dir}/SKILL.md`)).toBe('# Sample');
    const changed = await a.install({ ...skill, files: [{ path: 'SKILL.md', contents: 'new' }] }, 'global', { mode: 'copy', overwrite: true });
    const backups = await p.db.select<{ backup_dir: string }>('SELECT * FROM backups');
    expect(await p.fs.readText(`${backups[0].backup_dir}/SKILL.md`)).toBe('# Sample');
    const disabled = await a.setEnabled(changed, false);
    expect(disabled.dir).toBe(`${p.dataDir}/disabled/claude/global/sample`);
    expect(await a.listInstalled()).toEqual([disabled]);
    await a.install(skill, 'global', { mode: 'copy' });
    await expect(a.setEnabled(disabled, true)).rejects.toBeInstanceOf(SkillExistsError);
    await a.uninstall((await a.listInstalled()).find(i => i.enabled)!);
    const enabled = await a.setEnabled(disabled, true);
    await a.uninstall(enabled);
    expect(await a.listInstalled()).toEqual([]);
    expect(await p.db.select('SELECT * FROM backups')).toHaveLength(3);
  } finally { await cleanup(); }
});
test('symlink lifecycle preserves source and backups preserve links', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    const a = createAgents(p).codex;
    const source = `${p.home}/source`;
    await p.fs.mkdirp(source);
    await p.fs.writeText(`${source}/SKILL.md`, 'source');
    const item = await a.install({ ...skill, files: [{ path: 'SKILL.md', contents: 'source' }] }, 'global', { mode: 'symlink', symlinkSource: source });
    expect(item.isSymlink).toBe(true);
    const disabled = await a.setEnabled(item, false);
    const enabled = await a.setEnabled(disabled, true);
    await a.uninstall(enabled);
    expect(await p.fs.readText(`${source}/SKILL.md`)).toBe('source');
    expect(await p.fs.exists(`${source}/.somm.json`)).toBe(false);
    expect((await p.fs.readDir(`${p.dataDir}/backups`))[0].isSymlink).toBe(true);
  } finally { await cleanup(); }
});
test('rejects unsafe names/files before changing an existing install', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    const a = createAgents(p).claude;
    await a.install(skill, 'global', { mode: 'copy' });
    for (const name of ['../escape', '/absolute', '..', 'a\\b']) await expect(a.install({ ...skill, name }, 'global', { mode: 'copy' })).rejects.toThrow();
    for (const path of ['../escape', '/absolute', '.somm.json', 'a/../../escape']) {
      await expect(a.install({ ...skill, files: [{ path, contents: 'bad' }] }, 'global', { mode: 'copy', overwrite: true })).rejects.toThrow();
    }
    expect(await p.fs.readText(`${a.skillDir('global')}/sample/SKILL.md`)).toBe('# Sample');
  } finally { await cleanup(); }
});
test('lists external skills and keeps disabled project skills scoped to their project', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    const a = createAgents(p).codex;
    const external = `${a.skillDir('global')}/external`;
    await p.fs.mkdirp(external);
    await p.fs.writeText(`${external}/SKILL.md`, 'external content');
    expect((await a.listInstalled())[0]).toMatchObject({ managedBySomm: false, hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const project = `${p.home}/project`, other = `${p.home}/other`;
    const item = await a.install(skill, 'project', { mode: 'copy', projectDir: project });
    await a.setEnabled(item, false);
    expect((await a.listInstalled(project)).filter(i => !i.enabled)).toHaveLength(1);
    expect((await a.listInstalled(other)).filter(i => !i.enabled)).toEqual([]);
    const conflicting = await a.install(skill, 'project', { mode: 'copy', projectDir: other });
    await expect(a.setEnabled(conflicting, false)).rejects.toBeInstanceOf(SkillExistsError);
    expect(await p.fs.exists(`${conflicting.dir}/SKILL.md`)).toBe(true);
  } finally { await cleanup(); }
});
test('backup failures and replacement rename failures preserve existing contents', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    const a = createAgents(p).claude;
    const item = await a.install(skill, 'global', { mode: 'copy' });
    const originalExecute = p.db.execute;
    p.db.execute = async () => { throw new Error('db unavailable'); };
    await expect(a.install(skill, 'global', { mode: 'copy', overwrite: true })).rejects.toThrow('db unavailable');
    expect(await p.fs.readText(`${item.dir}/SKILL.md`)).toBe('# Sample');
    p.db.execute = originalExecute;
    const originalRename = p.fs.rename;
    p.fs = { ...p.fs, async rename(from, to) {
      if (from.includes('/.somm-') && !from.includes('.somm-previous-') && to === item.dir) throw new Error('rename failed');
      await originalRename(from, to);
    } };
    await expect(a.install({ ...skill, files: [{ path: 'SKILL.md', contents: 'replacement' }] }, 'global', { mode: 'copy', overwrite: true })).rejects.toThrow('rename failed');
    expect(await p.fs.readText(`${item.dir}/SKILL.md`)).toBe('# Sample');
  } finally { await cleanup(); }
});
test('relative external links survive disabling and installed hashes reflect edits', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    const a = createAgents(p).claude;
    const installed = await a.install(skill, 'global', { mode: 'copy' });
    await p.fs.writeText(`${installed.dir}/SKILL.md`, 'changed');
    expect((await a.listInstalled())[0].hash).not.toBe(installed.hash);
    await p.fs.mkdirp(`${a.skillDir('global')}/source`);
    await p.fs.writeText(`${a.skillDir('global')}/source/SKILL.md`, 'linked');
    await p.fs.symlink('source', `${a.skillDir('global')}/relative`);
    const link = (await a.listInstalled()).find(i => i.name === 'relative')!;
    const disabled = await a.setEnabled(link, false);
    expect(await p.fs.readText(`${disabled.dir}/SKILL.md`)).toBe('linked');
    expect((await a.listInstalled()).find(i => i.name === 'relative')?.enabled).toBe(false);
    expect((await a.setEnabled(disabled, true)).isSymlink).toBe(true);
  } finally { await cleanup(); }
});
test('EXDEV moves copy across volumes and failed copies remove sidecars', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    const a = createAgents(p).codex;
    const item = await a.install(skill, 'global', { mode: 'copy' });
    const rename = p.fs.rename;
    p.fs = { ...p.fs, async rename(from, to) {
      if (from === item.dir) throw Object.assign(new Error('cross device'), { code: 'EXDEV' });
      await rename(from, to);
    } };
    const run = p.proc.run;
    p.proc = { ...p.proc, async run(bin, args, opts) {
      if (args[0] === '-R') return { code: 1, stdout: '', stderr: 'copy failed' };
      return run(bin, args, opts);
    } };
    await expect(a.setEnabled(item, false)).rejects.toThrow('copy failed');
    const target = `${p.dataDir}/disabled/codex/global/sample`;
    expect(await p.fs.exists(`${target}.somm-disabled.json`)).toBe(false);
    expect(await p.fs.exists(`${item.dir}/SKILL.md`)).toBe(true);
    p.proc = { ...p.proc, run };
    const disabled = await a.setEnabled(item, false);
    expect(await p.fs.exists(item.dir)).toBe(false);
    expect(await p.fs.readText(`${disabled.dir}/SKILL.md`)).toBe('# Sample');
  } finally { await cleanup(); }
});
test('partial source deletion retains complete recovery copy and its sidecar', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    const a = createAgents(p).codex;
    const item = await a.install(skill, 'global', { mode: 'copy' });
    const { rename, remove } = p.fs;
    p.fs = { ...p.fs, async rename(from, to) {
      if (from === item.dir) throw Object.assign(new Error('cross device'), { code: 'EXDEV' });
      await rename(from, to);
    }, async remove(path) {
      if (path === item.dir) { await remove(`${path}/SKILL.md`); throw new Error('partial deletion'); }
      await remove(path);
    } };
    const target = `${p.dataDir}/disabled/codex/global/sample`;
    await expect(a.setEnabled(item, false)).rejects.toMatchObject({ name: 'SkillMoveRecoveryError', sourceDir: item.dir, recoveryDir: target });
    expect(await p.fs.exists(`${item.dir}/SKILL.md`)).toBe(false);
    expect(await p.fs.readText(`${target}/SKILL.md`)).toBe('# Sample');
    expect(await p.fs.readText(`${target}/scripts/run.sh`)).toBe('echo hi');
    expect(await p.fs.exists(`${target}.somm-disabled.json`)).toBe(true);
    expect((await a.listInstalled()).find(i => i.dir === target)?.enabled).toBe(false);
  } finally { await cleanup(); }
});
test('denied readlink fails before mutation and never invokes Node', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    p.fs = { ...nodeFs, async readlink() { throw new Error('readlink denied'); } };
    const a = createAgents(p).claude;
    const source = `${p.home}/source`;
    await p.fs.mkdirp(source);
    await p.fs.writeText(`${source}/SKILL.md`, 'source');
    const item = await a.install(skill, 'global', { mode: 'symlink', symlinkSource: source });
    p.proc = { ...p.proc, async which() { throw new Error('must not spawn'); } };
    await expect(a.setEnabled(item, false)).rejects.toThrow('readlink denied');
    expect(await p.fs.readText(`${item.dir}/SKILL.md`)).toBe('source');
    expect(await p.fs.exists(`${p.dataDir}/disabled/claude/global/sample.somm-disabled.json`)).toBe(false);
  } finally { await cleanup(); }
});
for (const relative of [true, false]) {
  test(`enable preserves ${relative ? 'relative' : 'absolute'} intermediate symlink semantics`, async () => {
    const { p, cleanup } = await testPlatform();
    try {
      const a = createAgents(p).claude;
      const root = a.skillDir('global');
      for (const version of ['v1', 'v2']) {
        await p.fs.mkdirp(`${root}/${version}`);
        await p.fs.writeText(`${root}/${version}/SKILL.md`, version);
      }
      await p.fs.symlink('v1', `${root}/current`);
      const originalTarget = relative ? 'current' : `${root}/current`;
      await p.fs.symlink(originalTarget, `${root}/linked`);
      const item = (await a.listInstalled()).find(i => i.name === 'linked')!;
      const disabled = await a.setEnabled(item, false);
      expect(await p.fs.readText(`${disabled.dir}/SKILL.md`)).toBe('v1');
      const enabled = await a.setEnabled(disabled, true);
      expect(await p.fs.readlink(enabled.dir)).toBe(originalTarget);
      await p.fs.remove(`${root}/current`);
      await p.fs.symlink('v2', `${root}/current`);
      expect(await p.fs.readText(`${enabled.dir}/SKILL.md`)).toBe('v2');
    } finally { await cleanup(); }
  });
}
test('broken disabled link remains listed with recovery metadata until target returns', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    const a = createAgents(p).claude;
    const root = a.skillDir('global');
    await p.fs.mkdirp(`${root}/source`);
    await p.fs.writeText(`${root}/source/SKILL.md`, 'original');
    await p.fs.symlink('source', `${root}/linked`);
    const disabled = await a.setEnabled((await a.listInstalled()).find(i => i.name === 'linked')!, false);
    await p.fs.remove(`${root}/source`);
    expect((await a.listInstalled()).find(i => i.name === 'linked')).toMatchObject({ enabled: false, isSymlink: true, hash: '' });
    await expect(a.setEnabled(disabled, true)).rejects.toThrow('Recovery metadata retained');
    expect(await p.fs.exists(disabled.dir)).toBe(true);
    expect(JSON.parse(await p.fs.readText(`${disabled.dir}.somm-disabled.json`)).linkTarget).toBe('source');
    await p.fs.mkdirp(`${root}/source`);
    await p.fs.writeText(`${root}/source/SKILL.md`, 'restored');
    const enabled = await a.setEnabled(disabled, true);
    expect(await p.fs.readlink(enabled.dir)).toBe('source');
    expect(await p.fs.readText(`${enabled.dir}/SKILL.md`)).toBe('restored');
  } finally { await cleanup(); }
});
test('uninstall of broken disabled relative link preserves original-target sidecar in backup', async () => {
  const { p, cleanup } = await testPlatform();
  try {
    const a = createAgents(p).codex;
    const root = a.skillDir('global');
    await p.fs.mkdirp(`${root}/source`);
    await p.fs.writeText(`${root}/source/SKILL.md`, 'original');
    await p.fs.symlink('source', `${root}/linked`);
    const disabled = await a.setEnabled((await a.listInstalled()).find(i => i.name === 'linked')!, false);
    await p.fs.remove(`${root}/source`);
    const write = p.fs.writeText;
    p.fs = { ...p.fs, async writeText(path, text) {
      if (path.includes('/backups/') && path.endsWith('.somm-disabled.json')) { await write(path, 'partial'); throw new Error('sidecar backup failed'); }
      await write(path, text);
    } };
    await expect(a.uninstall(disabled)).rejects.toThrow('sidecar backup failed');
    expect(await p.fs.exists(disabled.dir)).toBe(true);
    expect(await p.fs.exists(`${disabled.dir}.somm-disabled.json`)).toBe(true);
    expect(await p.db.select('SELECT * FROM backups')).toEqual([]);
    expect(await p.fs.readDir(`${p.dataDir}/backups`)).toEqual([]);
    p.fs = { ...p.fs, writeText: write };
    const execute = p.db.execute;
    p.db.execute = async () => { throw new Error('backup DB failed'); };
    await expect(a.uninstall(disabled)).rejects.toThrow('backup DB failed');
    expect(await p.db.select('SELECT * FROM backups')).toEqual([]);
    expect(await p.fs.readDir(`${p.dataDir}/backups`)).toEqual([]);
    expect(await p.fs.exists(disabled.dir)).toBe(true);
    expect(JSON.parse(await p.fs.readText(`${disabled.dir}.somm-disabled.json`)).linkTarget).toBe('source');
    p.db.execute = async (sql, params) => {
      if (sql.startsWith('INSERT INTO backups')) {
        const path = params![5] as string;
        expect(await p.fs.readlink(path)).toBe(`${root}/source`);
        expect(JSON.parse(await p.fs.readText(`${path}.somm-disabled.json`)).linkTarget).toBe('source');
      }
      await execute(sql, params);
    };
    await a.uninstall(disabled);
    const rows = await p.db.select<{ backup_dir: string }>('SELECT backup_dir FROM backups');
    expect(rows).toHaveLength(1);
    const backup = rows.at(-1)!.backup_dir;
    expect(await p.fs.readlink(backup)).toBe(`${root}/source`);
    expect(JSON.parse(await p.fs.readText(`${backup}.somm-disabled.json`))).toMatchObject({ originalDir: `${root}/linked`, linkTarget: 'source' });
    expect(await p.fs.exists(disabled.dir)).toBe(false);
  } finally { await cleanup(); }
});
