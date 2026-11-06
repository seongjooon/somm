import type { Db } from './index';
export const SCHEMA_V1 = [
  'CREATE TABLE IF NOT EXISTS skills_cache (id TEXT PRIMARY KEY, json TEXT, fetched_at TEXT)',
  'CREATE TABLE IF NOT EXISTS scan_cache (skill_id TEXT PRIMARY KEY, content_hash TEXT, report_json TEXT, scanned_at TEXT)',
  'CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, skill_id TEXT, agent TEXT, auth TEXT, runs_mode TEXT, task TEXT, status TEXT, started_at TEXT, finished_at TEXT, result_json TEXT)',
  'CREATE TABLE IF NOT EXISTS run_arms (run_id TEXT, arm TEXT, iteration INTEGER, metrics_json TEXT, events_jsonl TEXT)',
  'CREATE TABLE IF NOT EXISTS backups (id TEXT PRIMARY KEY, agent TEXT, scope TEXT, name TEXT, original_dir TEXT, backup_dir TEXT, action TEXT, created_at TEXT)',
];
export async function migrate(db: Db): Promise<void> {
  await db.execute('PRAGMA journal_mode=WAL');
  const [row] = await db.select<{ user_version: number }>('PRAGMA user_version');
  if (row.user_version >= 1) return;
  for (const sql of SCHEMA_V1) await db.execute(sql);
  await db.execute('PRAGMA user_version=1');
}
