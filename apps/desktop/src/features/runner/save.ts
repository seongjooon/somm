import { saveRun, type AgentEvent, type Platform, type RunResult } from '@somm/core';

export class RunSaveError extends Error {
  readonly cleanupFailed: boolean;
  readonly recoveryPath?: string;
  constructor(result: RunResult, key?: string) {
    super('Run result could not be saved');
    this.name = 'RunSaveError';
    this.cleanupFailed = result.warnings.includes('cleanup-failed');
    const path = result.cleanupRecoveryPath;
    this.recoveryPath = path && key ? [key, JSON.stringify(key).slice(1, -1)].reduce((value, part) => part ? value.split(part).join('[REDACTED]') : value, path) : path;
  }
}
export async function saveResult(p: Platform, result: RunResult, events: Record<string, AgentEvent[]>, key?: string): Promise<void> {
  try { await saveRun(p, result, events); }
  catch { throw new RunSaveError(result, key); }
}
