import { expect, test } from 'vitest';
import { migrate, SCHEMA_V1 } from './migrate';
import type { Db } from './index';
test('migrates across pooled calls without a split transaction', async () => {
  const executed: string[] = [];
  const db: Db = {
    async select<T>() { return [{ user_version: 0 }] as T[]; },
    async execute(sql) {
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) throw new Error('transaction may use a different pooled connection');
      executed.push(sql);
    },
  };
  await migrate(db);
  expect(executed).toEqual(['PRAGMA journal_mode=WAL', ...SCHEMA_V1, 'PRAGMA user_version=1']);
});

import { createNodePlatform } from '../node';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('initializes the real Node database idempotently with WAL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'somm-db-'));
  const previous = process.env.SOMM_DATA_DIR;
  process.env.SOMM_DATA_DIR = `${dir}/data`;
  try {
    const { db } = await createNodePlatform();
    await migrate(db);
    expect(await db.select('PRAGMA busy_timeout')).toEqual([{ timeout: 5000 }]);
    expect(await db.select('PRAGMA user_version')).toEqual([{ user_version: 1 }]);
    expect(await db.select('PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }]);
    expect(await db.select("SELECT name FROM sqlite_master WHERE type='table'")).toHaveLength(5);
    await db.execute('INSERT INTO skills_cache (id) VALUES (?)', ['test']);
    expect(await db.select('SELECT id FROM skills_cache WHERE id=?', ['test'])).toEqual([{ id: 'test' }]);
  } finally {
    if (previous === undefined) delete process.env.SOMM_DATA_DIR;
    else process.env.SOMM_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
