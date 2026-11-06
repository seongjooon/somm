import type { AgentAdapter } from '../agents';
import type { Platform } from '../platform';
import type { Sandbox } from '../sandbox';
import type { RunOptions, SkillMeta } from '../types';
import { invokeAgent, makeScrub } from './exec';
import { RunCleanupError } from './cleanup';
import { parseTasks, proposeTasksPrompt } from './verdict';

export class TargetInResidueError extends Error {
  constructor(public skillName: string, public residue: string[]) {
    super('target-in-residue');
    this.name = 'TargetInResidueError';
  }
}

export async function proposeTasks(p: Platform, deps: { agent: AgentAdapter; sandbox: Sandbox }, req: {
  runId: string; projectDir: string; skill: Pick<SkillMeta, 'name' | 'description'>; opts: RunOptions; signal: AbortSignal;
}): Promise<string[]> {
  let primary: unknown, failed = false;
  try {
    req.signal.throwIfAborted();
    if (!deps.sandbox.preparePreflight || !deps.sandbox.prepareDependencies) throw new Error('Sandbox does not support safe preflight');
    const prepared = await deps.sandbox.preparePreflight(req.projectDir, req.runId);
    req.signal.throwIfAborted();
    let residue = await deps.agent.enumerateSkills(prepared.base);
    if (residue.includes(req.skill.name)) throw new TargetInResidueError(req.skill.name, residue);
    req.signal.throwIfAborted();
    const status = await Promise.race([deps.agent.detect(), new Promise<never>((_, reject) => {
      const signal = AbortSignal.any([req.signal, AbortSignal.timeout(30_000)]);
      signal.addEventListener('abort', () => reject(req.signal.aborted ? req.signal.reason : new Error('Agent detection timed out')), { once: true });
    })]);
    if (!status.installed || status.loggedIn === false) throw new Error('Agent unavailable or not logged in. Install the agent and log in, then retry.');
    req.signal.throwIfAborted();
    await deps.sandbox.prepareDependencies(prepared.base, { signal: req.signal });
    req.signal.throwIfAborted();
    residue = await deps.agent.enumerateSkills(prepared.base);
    if (residue.includes(req.skill.name)) throw new TargetInResidueError(req.skill.name, residue);
    req.signal.throwIfAborted();
    const tree: string[] = [];
    async function visit(dir: string, prefix = ''): Promise<void> {
      for (const entry of await p.fs.readDir(dir)) {
        if (tree.length >= 200) return;
        if (entry.isSymlink || entry.name === '.git' || entry.name === 'node_modules') continue;
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        tree.push(path);
        if (entry.isDir) await visit(`${dir}/${entry.name}`, path);
      }
    }
    await visit(prepared.base);
    const out = await invokeAgent(p, deps.agent, { cwd: prepared.base, tmpHome: `${prepared.base}/../home-proposal`, prompt: proposeTasksPrompt(req.skill, tree), opts: req.opts, signal: req.signal, scrub: makeScrub(req.opts.apiKey) });
    if (out.auth) throw new Error('Agent authentication failed. Log in and retry.');
    if (out.budget) throw new Error('Agent budget exceeded while proposing tasks.');
    if (out.timedOut || out.code !== 0) throw new Error('Agent could not propose tasks.');
    return parseTasks(out.events.map(e => e.text ?? '').join('\n'));
  } catch (error) { primary = error; failed = true; throw error; }
  finally {
    try { await deps.sandbox.cleanup(req.runId); }
    catch (cleanup) { throw new RunCleanupError(p, req.runId, req.opts.apiKey, failed ? primary : new Error('Task proposal completed'), cleanup); }
  }
}
