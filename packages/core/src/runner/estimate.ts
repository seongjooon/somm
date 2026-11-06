import type { RunOptions } from '../types';

export interface UsageEstimate { agentCalls: number; abRuns: number; avgTokens?: number; maxUsd?: number; warnThorough: boolean }

export function estimateUsage(opts: RunOptions, customTask: boolean, history: number[]): UsageEstimate {
  const abRuns = opts.runs === 'thorough' ? 6 : 2;
  const agentCalls = abRuns + 1 + (customTask ? 0 : 1);
  const est: UsageEstimate = { agentCalls, abRuns, warnThorough: opts.auth === 'subscription' && opts.runs === 'thorough' };
  if (history.length) est.avgTokens = history.reduce((a, b) => a + b, 0) / history.length;
  if (opts.auth === 'isolated' && opts.budgetUsd !== undefined) est.maxUsd = opts.budgetUsd * agentCalls;
  return est;
}
