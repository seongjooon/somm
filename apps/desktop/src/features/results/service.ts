import type { ArmMetrics, Platform, RunResult, ScanReport } from '@somm/core';
import { createTauriPlatform } from '../../platform';

export async function loadResult(p: Platform, id: string): Promise<{ result: RunResult; report: ScanReport | null }> {
  const rows = await p.db.select<{ result_json: string }>('SELECT result_json FROM runs WHERE id = ?', [id]);
  if (!rows[0]) throw new Error('Result not found');
  const result = JSON.parse(rows[0].result_json) as RunResult;
  const arms = await p.db.select<{ arm: string; iteration: number; metrics_json: string }>('SELECT arm, iteration, metrics_json FROM run_arms WHERE run_id = ? ORDER BY iteration', [id]);
  result.a = arms.filter(a => a.arm === 'a').map(a => JSON.parse(a.metrics_json) as ArmMetrics);
  result.b = arms.filter(a => a.arm === 'b').map(a => JSON.parse(a.metrics_json) as ArmMetrics);
  const stored = result as RunResult & { staticReport?: ScanReport };
  if (stored.staticReport) return { result, report: stored.staticReport };
  const identity = result.meta.identity;
  const scans = identity ? await p.db.select<{ report_json: string }>('SELECT report_json FROM scan_cache WHERE skill_id = ? AND content_hash = ?', [identity.source, identity.contentHash]) : [];
  return { result, report: scans[0] ? JSON.parse(scans[0].report_json) as ScanReport : null };
}
export async function load(id: string) { return loadResult(await createTauriPlatform(), id); }

export interface RunHistoryEntry { id: string; skill_id: string; agent: string; auth: string; runs_mode: string; status: string; started_at: string; finished_at: string | null }
export async function listResults(p: Platform): Promise<RunHistoryEntry[]> {
  return p.db.select<RunHistoryEntry>('SELECT id, skill_id, agent, auth, runs_mode, status, started_at, finished_at FROM runs ORDER BY started_at DESC, id DESC');
}
export async function history() { return listResults(await createTauriPlatform()); }
