export type AgentId = 'claude' | 'codex';
export type Scope = 'global' | 'project';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type AuthMode = 'subscription' | 'isolated';
export type RunsMode = 'quick' | 'thorough';
export type SourceId = 'sample' | 'github' | 'claude-official' | 'codex-official';
export interface Snapshot { date: string; value: number } // YYYY-MM-DD
export interface SkillMeta {
  id: string; name: string; description: string; source: SourceId;
  repoUrl: string; ref: string; path: string; isFork?: boolean;
  stars?: number; installs?: number; snapshots: Snapshot[];
  agents: AgentId[]; license?: string; category?: string; contentHash?: string;
}
export function skillText(contents: string | Uint8Array): string | undefined {
  if (typeof contents === 'string') return contents;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(contents);
    return text.includes('\0') ? undefined : text;
  } catch { return undefined; }
}
export interface SkillFile { path: string; contents: string | Uint8Array }
export interface SkillTraits { hasScripts: boolean; hasHooks: boolean; hasMcp: boolean; commands: string[] }
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export interface Finding { ruleId: string; severity: Severity; file: string; line: number; message: string }
export interface ScanReport { grade: Exclude<Grade, 'F'>; score: number; findings: Finding[] }
export interface Inventory { skills: string[]; plugins: string[]; mcp: string[] }
export interface AgentEvent {
  kind: 'init' | 'tool' | 'text' | 'usage' | 'error' | 'done';
  tool?: { name: string; input: string; output?: string };
  text?: string; usage?: { input: number; output: number };
  error?: { code: 'auth' | 'budget' | 'other'; message: string };
  inventory?: Inventory; raw: unknown;
}
export interface RunOptions { agent: AgentId; auth: AuthMode; runs: RunsMode; apiKey?: string; budgetUsd?: number }
export interface Canary { path: string; token: string }
export interface DiffStat { files: number; added: number; removed: number; patch: string }
export interface ArmMetrics {
  ok: boolean; tokensIn: number; tokensOut: number; durationMs: number;
  tests: { passed: number; failed: number } | null; diff: DiffStat;
  inventory: Inventory; canaryHits: string[]; error?: string;
}
export interface Contamination {
  status: 'clean' | 'contaminated'; common: string[]; extras: string[];
  residue: string[];          // Shared skills not injected by somm; always shown in results and --json (spec 5.3).
  targetInResidue: boolean;   // The target already appears in residue, making A/B invalid.
}
export type Rating = 'recommend' | 'conditional' | 'not-recommended';
export interface Verdict { line: string; rating: Rating }
export type SommTag = '// somm: pairs well' | '// somm: needs to breathe' | '// somm: corked';
export interface InstalledSkill {
  agent: AgentId; scope: Scope; name: string; dir: string;
  enabled: boolean; hash: string; managedBySomm: boolean; isSymlink: boolean;
}

