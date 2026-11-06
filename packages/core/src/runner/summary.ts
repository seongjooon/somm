import type { ArmMetrics } from '../types';

export interface Summary {
  mean: { tokensIn: number; tokensOut: number; durationMs: number; passed: number | null; failed: number | null; files: number };
  stdev?: Record<string, number>; okCount: number; total: number;
}
type Key = keyof Summary['mean'];
const KEYS: Key[] = ['tokensIn', 'tokensOut', 'durationMs', 'passed', 'failed', 'files'];
const value = (a: ArmMetrics, k: Key): number | null =>
  k === 'passed' ? a.tests?.passed ?? null : k === 'failed' ? a.tests?.failed ?? null : k === 'files' ? a.diff.files : a[k];
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

export function summarize(arms: ArmMetrics[]): Summary {
  const ok = arms.filter(a => a.ok);
  const out = { tokensIn: 0, tokensOut: 0, durationMs: 0, passed: null, failed: null, files: 0 } as Summary['mean'];
  const stdev: Record<string, number> = {};
  for (const k of KEYS) {
    const xs = ok.map(a => value(a, k)).filter((x): x is number => x !== null);
    if (!xs.length) continue;
    const m = mean(xs);
    (out as Record<Key, number | null>)[k] = m;
    if (xs.length > 1) stdev[k] = Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
  }
  return { mean: out, ...(Object.keys(stdev).length ? { stdev } : {}), okCount: ok.length, total: arms.length };
}

export function compare(a: Summary, b: Summary): { metric: string; a: number; b: number; deltaPct: number | null }[] {
  const rows: { metric: string; a: number; b: number; deltaPct: number | null }[] = [];
  for (const k of KEYS) {
    const x = a.mean[k], y = b.mean[k];
    if (x === null || y === null) continue;
    rows.push({ metric: k, a: x, b: y, deltaPct: x === 0 ? null : ((y - x) / x) * 100 });
  }
  return rows;
}
