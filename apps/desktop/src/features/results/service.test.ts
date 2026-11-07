import { expect, it } from 'vitest';
import type { Platform } from '@somm/core';
import { loadResult } from './service';

it('reconstructs both arms and loads only the matching static report', async () => {
  const queries: unknown[][] = [];
  const p = { db: { select: async (sql: string, params: unknown[]) => {
    queries.push(params);
    if (sql.includes('FROM runs')) return [{ result_json: JSON.stringify({ meta: { identity: { source: 'skill-id', contentHash: 'hash' } } }) }];
    if (sql.includes('FROM run_arms')) return [{ arm: 'a', metrics_json: '{"ok":true}' }, { arm: 'b', metrics_json: '{"ok":false}' }];
    return [{ report_json: '{"grade":"A","findings":[]}' }];
  } } } as unknown as Platform;
  const loaded = await loadResult(p, 'run-id');
  expect(loaded.result.a[0].ok).toBe(true);
  expect(loaded.result.b[0].ok).toBe(false);
  expect(loaded.report?.grade).toBe('A');
  expect(queries[2]).toEqual(['skill-id', 'hash']);
});
it('reports a missing result', async () => {
  const p = { db: { select: async () => [] } } as unknown as Platform;
  await expect(loadResult(p, 'missing')).rejects.toThrow('Result not found');
});

it('lists saved runs in newest-first order without reading result payloads', async () => {
  const { listResults } = await import('./service');
  const rows = [{ id: 'new', skill_id: 'one' }, { id: 'old', skill_id: 'two' }];
  let query = '';
  const p = { db: { select: async (sql: string) => { query = sql; return rows; } } } as unknown as Platform;
  expect(await listResults(p)).toEqual(rows);
  expect(query).toContain('ORDER BY started_at DESC');
  expect(query).not.toContain('result_json');
});

it('prefers the run snapshot over a later scan cache', async () => {
  const queries: string[] = [];
  const p = { db: { select: async (sql: string) => {
    queries.push(sql);
    if (sql.includes('FROM runs')) return [{ result_json: JSON.stringify({ meta: {}, staticReport: { grade: 'B', findings: [] } }) }];
    if (sql.includes('FROM run_arms')) return [];
    throw new Error('should not query cache');
  } } } as unknown as Platform;
  expect((await loadResult(p, 'run')).report?.grade).toBe('B');
  expect(queries).toHaveLength(2);
});

it('reopens a saved run from history through a fresh service call', async () => {
  const sqliteModule = 'node:sqlite';
  const { DatabaseSync } = await import(sqliteModule);
  const { migrate, saveRun } = await import('@somm/core');
  const { listResults } = await import('./service');
  const db = new DatabaseSync(':memory:');
  const p = { db: {
    execute: async (sql: string, params: unknown[] = []) => { db.prepare(sql).run(...params as never[]); },
    select: async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params as never[]),
  } } as unknown as Platform;
  try {
    await migrate(p.db);
    const run = { runId: 'saved-run', a: [], b: [], contamination: { status: 'clean', common: [], extras: [], residue: [], targetInResidue: false }, verdict: null, grade: 'A', tag: '// somm: needs to breathe', confidence: 'low', warnings: [], meta: { skill: 'example', agent: 'codex', auth: 'subscription', runs: 'quick', task: 'test', startedAt: '2026-01-01', finishedAt: '2026-01-02' }, staticReport: { grade: 'A', score: 100, findings: [] } } as unknown as import('@somm/core').RunResult;
    await saveRun(p, run, {});
    const [entry] = await listResults(p);
    expect(entry.id).toBe('saved-run');
    const reopened = await loadResult(p, entry.id);
    expect(reopened.result.meta.skill).toBe('example');
    expect(reopened.result.contamination.residue).toEqual([]);
    expect(reopened.report?.grade).toBe('A');
  } finally { db.close(); }
});
