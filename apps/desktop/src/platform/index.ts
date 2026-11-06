import { invoke } from '@tauri-apps/api/core';
import * as fs from '@tauri-apps/plugin-fs';
import Database from '@tauri-apps/plugin-sql';
import { migrate, type Db, type Fs, type Platform } from '@somm/core';
import { tauriProc } from './proc';
const tauriFs: Fs = {
  async exists(p) { try { await fs.lstat(p); return true; } catch (error) {
    if (typeof error === 'string' && error.startsWith('failed to get metadata of path: ') && /with error: No such file or directory \(os error 2\)$/.test(error)) return false;
    throw error;
  } },
  readText: p => fs.readTextFile(p),
  writeText: (p, s) => fs.writeTextFile(p, s),
  async readDir(p) { return (await fs.readDir(p)).map(e => ({ name: e.name, isDir: e.isDirectory, isSymlink: e.isSymlink })); },
  mkdirp: p => fs.mkdir(p, { recursive: true }),
  async remove(p) { if (await tauriFs.exists(p)) await fs.remove(p, { recursive: true }); },
  readlink: path => invoke<string>('readlink', { path }),
  async rename(from, to) {
    try { await fs.rename(from, to); }
    catch (error) {
      // plugin-fs 2.7 serializes rename errors as strings, including OS errno.
      if (typeof error === 'string' && error.startsWith('failed to rename old path: ') && /with error: (?:Cross-device link|Invalid cross-device link) \(os error 18\)$/.test(error)) {
        throw Object.assign(new Error(error), { code: 'EXDEV' });
      }
      throw error;
    }
  },
  symlink: (target, link) => invoke('symlink', { target, link }),
};
export async function createTauriPlatform(): Promise<Platform> {
  const { home, dataDir, env } = await invoke<{ home: string; dataDir: string; env: Record<string, string> }>('platform_context');
  const database = await Database.load(`sqlite:${dataDir}/somm.db`);
  const db: Db = {
    select: (sql, params) => database.select(sql, params),
    async execute(sql, params) { await database.execute(sql, params); },
  };
  try { await migrate(db); } catch (error) { await database.close(); throw error; }
  return { fs: tauriFs, proc: tauriProc, db, home, dataDir, env };
}
