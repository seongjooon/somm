import type { AgentAdapter } from '../agents';
import type { Platform } from '../platform';
import { finalGrade } from '../scan';
import type { Sandbox } from '../sandbox';
import type { AgentEvent, ArmMetrics, Canary, Contamination, Grade, Inventory, RunOptions, SkillFile, SommTag, Verdict } from '../types';
import { runArm } from './arm';
import { contamination } from './contamination';
import { invokeAgent, makeScrub } from './exec';
import { compare, summarize } from './summary';
import { parseVerdict, sommTag, verdictPrompt } from './verdict';

export interface RunMeta { skill: string; agent: string; auth: string; runs: string; task: string; startedAt: string; finishedAt: string }
export interface RunResult {
  runId: string; a: ArmMetrics[]; b: ArmMetrics[]; contamination: Contamination; verdict: Verdict | null;
  grade: Grade; tag: SommTag; confidence: 'low' | 'normal'; warnings: string[]; meta: RunMeta;
}
export interface RunRequest {
  runId: string; skill: { name: string; files: SkillFile[] }; staticGrade: Exclude<Grade, 'F'>; projectDir: string; task: string;
  opts: RunOptions; signal: AbortSignal; onEvent: (arm: string, e: AgentEvent) => void;
}

const parentDir = (path: string) => path.slice(0, path.lastIndexOf('/'));
const safeRel = (path: string) => path !== '' && !path.startsWith('/') && !path.split('/').some(s => s === '..' || s === '');
const union = (invs: Inventory[]) => ({ skills: [...new Set(invs.flatMap(i => i.skills))], plugins: [], mcp: [] });

export async function runAB(p: Platform, deps: { agent: AgentAdapter; sandbox: Sandbox }, req: RunRequest): Promise<RunResult> {
  const { agent, sandbox } = deps;
  const { skill, opts, signal } = req;
  if (!/^[A-Za-z0-9._-]+$/.test(skill.name) || skill.name === '.' || skill.name === '..') throw new Error(`Unsafe skill name: ${skill.name}`);
  if (!skill.files.every(f => safeRel(f.path))) throw new Error('Skill contains an unsafe file path');
  const scrub = makeScrub(opts.apiKey);
  const startedAt = new Date().toISOString();
  const warnings: string[] = [];
  const a: ArmMetrics[] = [], b: ArmMetrics[] = [];
  let residue: string[] = [];
  const result = (verdict: Verdict | null, canaryHits: string[]): RunResult => {
    const all = [...a, ...b];
    const grade = finalGrade(req.staticGrade, canaryHits);
    const okMin = Math.min(a.filter(m => m.ok).length, b.filter(m => m.ok).length);
    return {
      runId: req.runId, a, b, verdict, grade, tag: sommTag(verdict?.rating ?? null, grade), warnings,
      contamination: contamination(union(a.map(m => m.inventory)), union(b.map(m => m.inventory)), skill.name, residue),
      confidence: opts.runs === 'quick' || okMin < 3 ? 'low' : 'normal',
      meta: { skill: skill.name, agent: opts.agent, auth: opts.auth, runs: opts.runs, task: req.task, startedAt, finishedAt: new Date().toISOString() },
    };
  };
  try {
    const status = await agent.detect();
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
    const hits: string[] = [];

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
        const out = await runArm(p, agent, sandbox, { name, dir, tmpHome, task: req.task, opts, signal, scrub, canaries, cleanupPaths, onEvent: req.onEvent });
        (side === 'a' ? a : b).push(out.metrics);
        hits.push(...out.metrics.canaryHits);
        if (out.auth) { warnings.push('auth'); break outer; }
        if (out.budget) { warnings.push('budget'); break outer; }
      }
    }
    if (hits.length || warnings.includes('auth') || !a.some(m => m.ok) || !b.some(m => m.ok)) return result(null, hits);

    let verdict: Verdict | null = null;
    try {
      const rows = compare(summarize(a), summarize(b));
      const inv = await invokeAgent(p, agent, { cwd: prepared.base, tmpHome: `${runDir}/home-verdict`, signal, scrub,
        prompt: verdictPrompt({ skill: skill.name, rows, diffA: a.find(m => m.ok)!.diff.patch, diffB: b.find(m => m.ok)!.diff.patch }), opts });
      verdict = parseVerdict(inv.events.map(e => e.text ?? '').join('\n'));
    } catch (err) {
      if (signal.aborted) throw err;
      warnings.push('verdict-failed');
    }
    return result(verdict, hits);
  } finally {
    await sandbox.cleanup(req.runId).catch(() => { warnings.push('cleanup-failed'); });
  }
}
