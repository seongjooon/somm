import { expect, test } from 'vitest';
import { mkdtemp, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { nodeFs } from '../node/fs';
import { nodeProc } from '../node/proc';
import { migrate, type Platform } from '../platform';
import { createAgents, SkillExistsError } from './index';
import { restoreBackup } from './restore';

async function setup() {
  const home = await mkdtemp(`${await realpath(tmpdir())}/somm 한글 space-`);
  const db = new DatabaseSync(':memory:');
  const p: Platform = { home, dataDir: `${home}/data`, env: {}, fs: nodeFs, proc: nodeProc, db: {
    async select<T>(sql: string, args: unknown[] = []) { return db.prepare(sql).all(...args as SQLInputValue[]) as T[]; },
    async execute(sql, args = []) { db.prepare(sql).run(...args as SQLInputValue[]); },
  } };
  await migrate(p.db);
  return { p, cleanup: async () => { db.close(); await rm(home, { recursive: true, force: true }); } };
}
const skill = { name: 'sample', files: [{ path: 'SKILL.md', contents: 'old' }] };

test('restores a backup, refuses collisions, and backs up overwrites', async () => {
  const { p, cleanup } = await setup();
  try {
    const project = `${p.home}/프로젝트 space`;
    const a = createAgents(p).claude;
    const old = await a.install(skill, 'project', { mode: 'copy', projectDir: project });
    await a.uninstall(old);
    const [backup] = await p.db.select<{ id: string }>('SELECT id FROM backups');
    await a.install({ ...skill, files: [{ path: 'SKILL.md', contents: 'new' }] }, 'project', { mode: 'copy', projectDir: project });
    await expect(restoreBackup(p, backup.id)).rejects.toBeInstanceOf(SkillExistsError);
    expect(await p.fs.readText(`${old.dir}/SKILL.md`)).toBe('new');
    await restoreBackup(p, backup.id, { overwrite: true });
    expect(await p.fs.readText(`${old.dir}/SKILL.md`)).toBe('old');
    const rows = await p.db.select<{ action: string }>('SELECT action FROM backups');
    expect(rows.map(row => row.action)).toEqual(['backup', 'backup', 'restore']);
  } finally { await cleanup(); }
});

test('rejects unsafe paths and missing backups', async () => {
  const { p, cleanup } = await setup();
  try {
    const item = await createAgents(p).codex.install(skill, 'global', { mode: 'copy' });
    await createAgents(p).codex.uninstall(item);
    const [row] = await p.db.select<{ id: string; original_dir: string; backup_dir: string }>('SELECT * FROM backups');
    for (const path of [`${p.home}/outside/sample`, `${p.home}/../.agents/skills/sample`]) {
      await p.db.execute('UPDATE backups SET original_dir = ? WHERE id = ?', [path, row.id]);
      await expect(restoreBackup(p, row.id)).rejects.toThrow();
    }
    await p.db.execute('UPDATE backups SET original_dir = ?, backup_dir = ? WHERE id = ?', [row.original_dir, `${p.dataDir}/backups/missing`, row.id]);
    await expect(restoreBackup(p, row.id)).rejects.toThrow(/backup/i);
  } finally { await cleanup(); }
});

test('restores disabled skill recovery metadata', async () => {
  const { p, cleanup } = await setup();
  try {
    const a = createAgents(p).claude;
    const projectDir = `${p.home}/프로젝트`;
    const item = await a.install(skill, 'project', { mode: 'copy', projectDir });
    const disabled = await a.setEnabled(item, false);
    await a.uninstall(disabled);
    const [backup] = await p.db.select<{ id: string }>('SELECT id FROM backups');
    await restoreBackup(p, backup.id);
    const restored = (await a.listInstalled(projectDir)).find(entry => !entry.enabled);
    expect(restored).toBeDefined();
    expect((await a.setEnabled(restored!, true)).dir).toBe(item.dir);
  } finally { await cleanup(); }
});

test('rejects a backup whose symlink points outside the allowed skill roots', async () => {
  const { p, cleanup } = await setup();
  try {
    const a = createAgents(p).claude;
    const item = await a.install(skill, 'global', { mode: 'copy' });
    await a.uninstall(item);
    const [row] = await p.db.select<{ id: string; backup_dir: string }>('SELECT * FROM backups');
    await p.fs.remove(row.backup_dir);
    await symlink(p.home, row.backup_dir);
    await expect(restoreBackup(p, row.id)).rejects.toThrow(/symlink/i);
  } finally { await cleanup(); }
});


test('refuses an existing symlink unless overwrite is confirmed', async () => {
  const { p, cleanup } = await setup();
  try {
    const a = createAgents(p).claude;
    const item = await a.install(skill, 'global', { mode: 'copy' });
    await a.uninstall(item);
    const [backup] = await p.db.select<{ id: string }>('SELECT id FROM backups');
    const outside = `${p.home}/external`;
    await p.fs.mkdirp(outside);
    await symlink(outside, item.dir);
    await expect(restoreBackup(p, backup.id)).rejects.toBeInstanceOf(SkillExistsError);
    await restoreBackup(p, backup.id, { overwrite: true });
    expect(await p.fs.readText(`${item.dir}/SKILL.md`)).toBe('old');
  } finally { await cleanup(); }
});

test('restores into a missing skills directory without inspecting its parents', async () => {
  const { p, cleanup } = await setup();
  try {
    const a = createAgents(p).claude;
    const item = await a.install(skill, 'global', { mode: 'copy' });
    await a.uninstall(item);
    const [backup] = await p.db.select<{ id: string }>('SELECT id FROM backups');
    const skills = `${p.home}/.claude/skills`;
    const backupRoot = `${p.dataDir}/backups`;
    await p.fs.remove(skills);
    const actual = p.fs;
    const check = (path: string) => {
      if (!(path === skills || path.startsWith(`${skills}/`) || path === backupRoot || path.startsWith(`${backupRoot}/`))) {
        throw new Error(`Out-of-scope filesystem access: ${path}`);
      }
    };
    p.fs = { ...actual,
      async exists(path) { check(path); return actual.exists(path); },
      async readDir(path) { check(path); return actual.readDir(path); },
    };
    await restoreBackup(p, backup.id);
    expect(await p.fs.readText(`${item.dir}/SKILL.md`)).toBe('old');
  } finally { await cleanup(); }
});
