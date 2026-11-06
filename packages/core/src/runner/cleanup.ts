import type { Platform } from '../platform';
import { makeScrub } from './exec';

export function recoveryPath(p: Platform, runId: string, key?: string): string | undefined {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(runId) ? makeScrub(key).str(`${p.dataDir.replace(/\/$/, '')}/runs/${runId}`) : undefined;
}

export class RunCleanupError extends Error {
  readonly primaryName: string;
  readonly primaryMessage: string;
  readonly cleanupMessage: string;
  readonly recoveryPath?: string;
  constructor(p: Platform, runId: string, key: string | undefined, primary: unknown, cleanup: unknown) {
    const scrub = makeScrub(key).str;
    const name = scrub(primary instanceof Error ? primary.name : 'Error');
    const message = scrub(primary instanceof Error ? primary.message : String(primary));
    const cleanupMessage = scrub(cleanup instanceof Error ? cleanup.message : String(cleanup));
    const path = recoveryPath(p, runId, key);
    const cause = Object.assign(new Error(message), { name });
    super(`${name}: ${message}; cleanup failed: ${cleanupMessage}${path ? `; recovery path: ${path}` : ''}`, { cause });
    this.name = 'RunCleanupError';
    this.primaryName = name; this.primaryMessage = message; this.cleanupMessage = cleanupMessage; this.recoveryPath = path;
  }
}
