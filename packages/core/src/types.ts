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
export interface SkillFile { path: string; contents: string }
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
  residue: string[];          // 스펙 5.3 공통 잔여: somm이 넣지 않았는데 양쪽 arm에 보이는 스킬 이름(결과·--json에 항상 표시)
  targetInResidue: boolean;   // 대상 스킬 이름이 residue에 있음 → A/B 무의미
}
export type Rating = 'recommend' | 'conditional' | 'not-recommended';
export interface Verdict { line: string; rating: Rating }
export type SommTag = '// somm: pairs well' | '// somm: needs to breathe' | '// somm: corked';
export interface InstalledSkill {
  agent: AgentId; scope: Scope; name: string; dir: string;
  enabled: boolean; hash: string; managedBySomm: boolean; isSymlink: boolean;
}

