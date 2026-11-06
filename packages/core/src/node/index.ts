import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { migrate, resolveDataDir, type Db, type Platform } from '../platform';
import { nodeFs } from './fs';
import { nodeProc } from './proc';
export async function createNodePlatform(): Promise<Platform> {
  const home = homedir();
  const env = { ...process.env };
  const dataDir = resolveDataDir(env, home);
  await nodeFs.mkdirp(dataDir);
  const database = new DatabaseSync(join(dataDir, 'somm.db'));
  const db: Db = {
    async select<T>(sql: string, params: unknown[] = []) { return database.prepare(sql).all(...params as SQLInputValue[]) as T[]; },
    async execute(sql, params = []) { database.prepare(sql).run(...params as SQLInputValue[]); },
  };
  try { await migrate(db); } catch (error) { database.close(); throw error; }
  return { fs: nodeFs, proc: nodeProc, db, home, dataDir, env };
}
