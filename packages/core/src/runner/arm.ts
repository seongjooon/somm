import type { AgentAdapter } from '../agents';
import type { Platform } from '../platform';
import { SANDBOX_GIT_ENV, type Sandbox } from '../sandbox';
import type { AgentEvent, ArmMetrics, Canary, RunOptions } from '../types';
import { canaryHits } from './canary';
import { invokeAgent, TEST_TIMEOUT_MS, AGENT_TIMEOUT_MS, type Scrub } from './exec';
import { detectTestCommand, parseTestOutput } from './tests';

export interface ArmInput {
  name: string; dir: string; tmpHome: string; task: string; opts: RunOptions; signal: AbortSignal; scrub: Scrub;
  model?: string; canaries: Canary[]; cleanupPaths: string[]; timeouts?: { test: number; agent: number }; onEvent: (arm: string, e: AgentEvent) => void;
}
export interface ArmOutput { metrics: ArmMetrics; events: AgentEvent[]; auth: boolean; budget: boolean; warnings: string[] }

interface TestRun { tests: { passed: number; failed: number } | null; error?: string; warning?: string }
async function runTests(p: Platform, dir: string, signal: AbortSignal, timeoutMs: number): Promise<TestRun> {
  const deadline = AbortSignal.timeout(timeoutMs);
  try {
    const cmd = await detectTestCommand(p, dir);
    if (!cmd) return { tests: null };
    const env = { ...SANDBOX_GIT_ENV, ANTHROPIC_API_KEY: null, CODEX_API_KEY: null };
    const r = await p.proc.run(cmd[0], cmd.slice(1), { cwd: dir, env, signal: AbortSignal.any([signal, deadline]) });
    return { tests: parseTestOutput(`${r.stdout}\n${r.stderr}`) };
  } catch (err) {
    if (signal.aborted) throw err;
    if (deadline.aborted) return { tests: null, error: `Test command timed out after ${Math.round(timeoutMs / 1000)}s` };
    return { tests: null, warning: 'tests-failed-to-run' };
  }
}

export async function runArm(p: Platform, agent: AgentAdapter, sandbox: Sandbox, a: ArmInput): Promise<ArmOutput> {
  const skills = new Set(await agent.enumerateSkills(a.dir));
  if (a.opts.agent === 'codex') for (const s of await agent.enumerateSkills(a.tmpHome)) skills.add(s);
  const started = Date.now();
  const inv = await invokeAgent(p, agent, { cwd: a.dir, tmpHome: a.tmpHome, prompt: a.task, opts: a.opts, model: a.model, signal: a.signal,
    scrub: a.scrub, timeoutMs: a.timeouts?.agent ?? AGENT_TIMEOUT_MS, onEvent: e => a.onEvent(a.name, e) });
  const durationMs = Date.now() - started;
  const ran = await runTests(p, a.dir, a.signal, a.timeouts?.test ?? TEST_TIMEOUT_MS);
  // Somm-planted files (canaries, injected skill) are not part of the agent's work.
  for (const path of a.cleanupPaths) await p.fs.remove(path);
  const stat = await sandbox.diffStat(a.dir);
  const diff = { ...stat, patch: a.scrub.str(stat.patch) };
  let tokensIn = 0, tokensOut = 0;
  for (const e of inv.events) if (e.usage) { tokensIn += e.usage.input; tokensOut += e.usage.output; }
  const init = inv.events.find(e => e.kind === 'init')?.inventory;
  const failure = inv.events.find(e => e.kind === 'error')?.error?.message
    ?? (inv.timedOut ? `Agent timed out after ${Math.round((a.timeouts?.agent ?? AGENT_TIMEOUT_MS) / 1000)}s` : undefined)
    ?? ran.error
    ?? (inv.code !== 0 ? (inv.stderr.trim() || `Exited with code ${inv.code}`) : undefined);
  const metrics: ArmMetrics = {
    ok: failure === undefined, tokensIn, tokensOut, durationMs, tests: ran.tests, diff,
    inventory: init ?? { skills: [...skills].sort(), plugins: [], mcp: [] },
    canaryHits: canaryHits(inv.events, a.canaries),
    ...(failure === undefined ? {} : { error: a.scrub.str(failure) }),
  };
  return { metrics, events: inv.events, auth: inv.auth, budget: inv.budget, warnings: ran.warning ? [ran.warning] : [] };
}
