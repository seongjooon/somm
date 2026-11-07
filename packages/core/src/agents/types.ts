import type { AgentEvent, AgentId, InstalledSkill, RunOptions, Scope, SkillFile } from '../types';

export interface DetectResult { installed: boolean; binPath?: string; version?: string; loggedIn: boolean | 'unknown' }
// Execute with stdin closed. For isolated Codex, the caller must create env.CODEX_HOME first.
export interface RunSpec { bin: string; args: string[]; env: Record<string, string | null>; cwd: string }
export interface RunRequest { cwd: string; prompt: string; opts: RunOptions; tmpHome: string; model?: string; allowedBash?: string[] }
export interface InstallOptions { mode: 'copy' | 'symlink'; projectDir?: string; overwrite?: boolean; symlinkSource?: string }
export interface SkillInput { name: string; files: SkillFile[]; source?: string }
export interface AgentAdapter {
  id: AgentId;
  detect(options?: { installationOnly?: boolean }): Promise<DetectResult>;
  skillDir(scope: Scope, projectDir?: string): string;
  listInstalled(projectDir?: string): Promise<InstalledSkill[]>;
  install(skill: SkillInput, scope: Scope, opts: InstallOptions): Promise<InstalledSkill>;
  uninstall(item: InstalledSkill): Promise<void>;
  setEnabled(item: InstalledSkill, enabled: boolean): Promise<InstalledSkill>;
  buildRun(req: RunRequest): RunSpec;
  parseLine(line: string): AgentEvent | null;
  listPlugins(): Promise<string[]>;
  enumerateSkills(armDir: string): Promise<string[]>;
}
export class SkillExistsError extends Error {
  constructor(dir: string) { super(`Skill already exists: ${dir}`); this.name = 'SkillExistsError'; }
}

export class SkillMoveRecoveryError extends Error {
  constructor(public sourceDir: string, public recoveryDir: string, cause: unknown) {
    super(`Source removal failed; source may be incomplete: ${sourceDir}. Complete copy preserved at ${recoveryDir}`, { cause });
    this.name = 'SkillMoveRecoveryError';
  }
}
