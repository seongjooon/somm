import type { Canary, DiffStat } from '../types';
export type SandboxWarning = 'uncommitted-changes' | 'not-git' | 'submodules' | 'lfs' | 'secrets-removed' | 'lockfile-drift' | 'slow-copy' | 'deps-install-failed';
export interface DepsResult { mode: 'cloned' | 'installed' | 'none'; cmd?: string[]; ok: boolean; log: string }
export interface Sandbox {
  prepare(projectDir: string, runId: string, options?: { deferDependencies?: boolean }): Promise<{ base: string; deps: DepsResult; warnings: SandboxWarning[] }>;
  preparePreflight?(projectDir: string, runId: string): Promise<{ base: string; deps: DepsResult; warnings: SandboxWarning[] }>;
  prepareDependencies?(base: string): Promise<DepsResult>;
  split(base: string, arms: string[]): Promise<Record<string, string>>;
  plantCanaries(t: { projectDir: string; homeDir?: string }): Promise<Canary[]>;
  diffStat(armDir: string): Promise<DiffStat>;
  cleanup(runId: string): Promise<void>;
}
export { createLiteSandbox, SANDBOX_GIT_ENV } from './lite';
