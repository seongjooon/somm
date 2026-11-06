import type { AgentAdapter } from '../agents';
import type { Platform } from '../platform';
import { finalGrade } from '../scan';
import type { Sandbox } from '../sandbox';
import type { AgentEvent, ArmMetrics, Canary, Contamination, Grade, Inventory, RunOptions, SkillFile, SommTag, Verdict } from '../types';
import { runArm } from './arm';
import { contamination } from './contamination';
import { DEFAULT_TIMEOUTS, invokeAgent, makeScrub, type Timeouts } from './exec';
import { compare, summarize } from './summary';
import { parseVerdict, sommTag, verdictPrompt } from './verdict';

export interface RunMeta { skill: string; agent: string; auth: string; runs: string; task: string; startedAt: string; finishedAt: string }
export interface RunResult {
  runId: string; a: ArmMetrics[]; b: ArmMetrics[]; contamination: Contamination; verdict: Verdict | null;
  grade: Grade; tag: SommTag; confidence: 'low' | 'normal'; warnings: string[]; meta: RunMeta;
}
export interface RunABRequest {
  runId: string; skill: { name: string; files: SkillFile[] }; staticGrade: Exclude<Grade, 'F'>; projectDir: string; task: string;
  opts: RunOptions; signal: AbortSignal; onEvent: (arm: string, e: AgentEvent) => void;
  timeouts?: Partial<Timeouts>;   // Tests inject tiny values; defaults are DEFAULT_TIMEOUTS.
}

const parentDir = (path: string) => path.slice(0, path.lastIndexOf('/'));
const safeRel = (path: string) => path !== '' && !path.startsWith('/') && !path.split('/').some(s => s === '..' || s === '');
const union = (invs: Inventory[]) => ({ skills: [...new Set(invs.flatMap(i => i.skills))], plugins: [], mcp: [] });

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T | 'timeout'> => {
  let timer: ReturnType<typeof setTimeout>;
  const limit = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), ms); });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
};

export async function runAB(p: Platform, deps: { agent: AgentAdapter; sandbox: Sandbox }, req: RunABRequest): Promise<RunResult> {
  let outcome: RunResult | undefined, thrown: unknown, failed = false;
  try { outcome = await execute(p, deps, req); } catch (err) { thrown = err; failed = true; }
  // Cleanup always runs, also after an abort or a thrown error; its failure is reported, never masks the real error.
  const cleaned = await deps.sandbox.cleanup(req.runId).then(() => true, () => false);
  if (failed) throw thrown;
  return cleaned ? outcome! : { ...outcome!, warnings: [...outcome!.warnings, 'cleanup-failed'] };
}

async function execute(p: Platform, deps: { agent: AgentAdapter; sandbox: Sandbox }, req: RunABRequest): Promise<RunResult> {
  const { agent, sandbox } = deps;
  const { skill, opts, signal } = req;
  if (!/^[A-Za-z0-9._-]+$/.test(skill.name) || skill.name === '.' || skill.name === '..') throw new Error(`Unsafe skill name: ${skill.name}`);
  if (!skill.files.every(f => safeRel(f.path))) throw new Error('Skill contains an unsafe file path');
  const timeouts = { ...DEFAULT_TIMEOUTS, ...req.timeouts };
  const scrub = makeScrub(opts.apiKey);
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  const a: ArmMetrics[] = [], b: ArmMetrics[] = [];
  let residue: string[] = [];
  // Only hits in B grade the skill: A runs without it, so an A hit is the agent's own behavior.
  const result = (verdict: Verdict | null, bHits: string[]): RunResult => {
    const grade = finalGrade(req.staticGrade, bHits);
    const okMin = Math.min(a.filter(m => m.ok).length, b.filter(m => m.ok).length);
    // No arm ran: nothing can be said about B, except that a target already in the residue invalidates the test.
    const noArms = a.length + b.length === 0;
    const cont: Contamination = noArms && !residue.includes(skill.name)
      ? { status: 'clean', common: [], extras: [], residue: [...new Set(residue)].sort(), targetInResidue: false }
      : contamination(union(a.map(m => m.inventory)), union(b.map(m => m.inventory)), skill.name, residue);
    return {
      runId: req.runId, a, b, verdict, grade, tag: sommTag(verdict?.rating ?? null, grade), warnings: [...warnings],
      contamination: cont, confidence: opts.runs === 'quick' || okMin < 3 ? 'low' : 'normal',
      meta: { skill: skill.name, agent: opts.agent, auth: opts.auth, runs: opts.runs, task: req.task, startedAt, finishedAt: new Date().toISOString() },
    };
  };

  const status = await withTimeout(agent.detect(), timeouts.detect);
  if (status === 'timeout') { warnings.push('detect-timeout'); return result(null, []); }
  if (!status.installed || status.loggedIn === false) { warnings.push('auth'); return result(null, []); }
  signal.throwIfAborted();
  const prepared = await sandbox.prepare(req.projectDir, req.runId);
  warnings.push(...prepared.warnings);
  residue = await agent.enumerateSkills(prepared.base);
  if (residue.includes(skill.name)) { warnings.push('target-in-residue'); return result(null, []); }

  const count = opts.runs === 'thorough' ? 3 : 1;
  const names = Array.from({ length: count }, (_, i) => [`a-${i}`, `b-${i}`]).flat();
  const dirs = await sandbox.split(prepared.base, names);
  const runDir = parentDir(prepared.base);
  const hitsA: string[] = [], hitsB: string[] = [];

  outer: for (let i = 0; i < count; i++) {
    for (const side of ['a', 'b'] as const) {
      signal.throwIfAborted();
      const name = `${side}-${i}`, dir = dirs[name], tmpHome = `${runDir}/home-${name}`;
      const canaries: Canary[] = await sandbox.plantCanaries({ projectDir: dir, ...(opts.agent === 'codex' ? { homeDir: tmpHome } : {}) });
      const cleanupPaths = canaries.map(c => c.path).filter(path => path.startsWith(`${dir}/`));
      if (side === 'b') {
        const root = `${agent.skillDir('project', dir)}/${skill.name}`;
        for (const f of skill.files) {
          const target = `${root}/${f.path}`;
          await p.fs.mkdirp(parentDir(target));
          if (typeof f.contents === 'string') await p.fs.writeText(target, f.contents);
          else await p.fs.writeBytes(target, f.contents);
        }
        cleanupPaths.push(root);
      }
      const out = await runArm(p, agent, sandbox, { name, dir, tmpHome, task: req.task, opts, signal, scrub, canaries, cleanupPaths,
        timeouts, onEvent: req.onEvent });
      (side === 'a' ? a : b).push(out.metrics);
      (side === 'a' ? hitsA : hitsB).push(...out.metrics.canaryHits);
      for (const w of out.warnings) if (!warnings.includes(w)) warnings.push(w);
      if (out.auth) { warnings.push('auth'); break outer; }
      if (out.budget) { warnings.push('budget'); break outer; }
    }
  }
  if (hitsA.length) warnings.push('canary-in-baseline');
  if (hitsB.length || warnings.includes('auth') || warnings.includes('budget') || !a.some(m => m.ok) || !b.some(m => m.ok)) return result(null, hitsB);

  let verdict: Verdict | null = null;
  try {
    const rows = compare(summarize(a), summarize(b));
    const inv = await invokeAgent(p, agent, { cwd: prepared.base, tmpHome: `${runDir}/home-verdict`, signal, scrub, timeoutMs: timeouts.agent,
      prompt: verdictPrompt({ skill: skill.name, rows, diffA: a.find(m => m.ok)!.diff.patch, diffB: b.find(m => m.ok)!.diff.patch }), opts });
    if (inv.auth) warnings.push('verdict-auth');
    else if (inv.budget) warnings.push('verdict-budget');
    else if (inv.timedOut) warnings.push('verdict-timeout');
    else verdict = parseVerdict(inv.events.map(e => e.text ?? '').join('\n'));
  } catch (err) {
    if (signal.aborted) throw err;
    warnings.push('verdict-failed');
  }
  return result(verdict, hitsB);
}
