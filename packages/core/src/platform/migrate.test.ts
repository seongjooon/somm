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
