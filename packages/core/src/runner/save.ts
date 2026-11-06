import type { Platform } from '../platform';
import type { AgentEvent } from '../types';
import type { RunResult } from './run';

// `events` must be the scrubbed events delivered through runAB's onEvent, keyed by arm name ('a-0', 'b-0', ...).
export async function saveRun(p: Platform, r: RunResult, events: Record<string, AgentEvent[]>): Promise<void> {
  const { a, b, ...summary } = r;
  const count = r.meta.runs === 'thorough' ? 3 : 1;
  const status = r.verdict && r.a.length === count && r.b.length === count && [...r.a, ...r.b].every(arm => arm.ok) && !r.warnings.some(w => ['auth', 'budget', 'detect-timeout', 'target-in-residue', 'verdict-auth', 'verdict-budget', 'verdict-timeout', 'verdict-failed', 'cleanup-failed'].includes(w)) ? 'done' : 'stopped';
  await p.db.execute('DELETE FROM run_arms WHERE run_id = ?', [r.runId]);
  await p.db.execute(
    'INSERT OR REPLACE INTO runs (id, skill_id, agent, auth, runs_mode, task, status, started_at, finished_at, result_json) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [r.runId, r.meta.skill, r.meta.agent, r.meta.auth, r.meta.runs, r.meta.task, status, r.meta.startedAt, r.meta.finishedAt, JSON.stringify(summary)]);
  for (const [side, arms] of [['a', a], ['b', b]] as const) {
    for (const [i, m] of arms.entries()) {
      const log = (events[`${side}-${i}`] ?? []).map(e => JSON.stringify(e)).join('\n');
      await p.db.execute('INSERT INTO run_arms (run_id, arm, iteration, metrics_json, events_jsonl) VALUES (?,?,?,?,?)',
        [r.runId, side, i, JSON.stringify(m), log]);
    }
  }
}
