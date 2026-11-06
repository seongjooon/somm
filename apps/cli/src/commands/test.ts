import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { createAgents, createLiteSandbox, runAB, proposeTasks, saveRun, scanSkill, skillTraits, estimateUsage, summarize, compare, hashFiles, RunCleanupError, type AgentId, type AgentEvent, type RunOptions } from '@somm/core';
import { emit, humanField, type CliContext } from '../output';
import { loadSkill, skillHistory } from './install';

export async function run(args: string[], ctx: CliContext): Promise<number> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  process.on('SIGINT', abort); process.on('SIGTERM', abort);
  try {
    const { values: v, positionals: p } = parseArgs({ args, allowPositionals: true, options: { agent: { type: 'string' }, project: { type: 'string' }, runs: { type: 'string' }, auth: { type: 'string' }, task: { type: 'string' }, budget: { type: 'string' }, yes: { type: 'boolean' }, json: { type: 'boolean' }, refresh: { type: 'boolean' } } });
    if (p.length !== 1 || !v.project || !['claude', 'codex'].includes(v.agent ?? '') || !['quick', 'thorough'].includes(v.runs ?? 'quick') || !['subscription', 'isolated'].includes(v.auth ?? 'subscription') || (v.budget !== undefined && (!Number.isFinite(Number(v.budget)) || Number(v.budget) <= 0))) throw new Error('Usage: somm test <skill> --project <dir> --agent claude|codex');
    if (ctx.json && !v.task) throw new Error('--task is required with --json');
    const opts: RunOptions = { agent: v.agent as AgentId, runs: (v.runs ?? 'quick') as RunOptions['runs'], auth: (v.auth ?? 'subscription') as RunOptions['auth'], ...(v.budget ? { budgetUsd: Number(v.budget) } : {}) };
    if (opts.auth === 'isolated') {
      const key = opts.agent === 'claude' ? 'ANTHROPIC_API_KEY' : 'CODEX_API_KEY';
      if (!process.env[key]) throw new Error(`${key} is required for isolated authentication`);
      opts.apiKey = process.env[key];
    }
    const skill = await loadSkill(p[0], ctx, v.refresh);
    const history = await skillHistory(skill, ctx);
    if (history.blocked || history.legacyBlocked) { emit(ctx, 'corked', [history.blocked ? 'This skill previously received grade F.' : 'A legacy F record has no source or content identity. Review it before testing a skill with this name.'], { legacyRecord: history.legacyBlocked && !history.blocked }); return 2; }
    const report = scanSkill(skill.files, { name: skill.name });
    const traits = skillTraits(skill.files);
    const bins = await ctx.platform.proc.which(['git', 'tar', 'cp', 'docker', 'pnpm', 'npm', 'yarn', 'uv']);
    if (!['A', 'B'].includes(report.grade) || traits.hasScripts || traits.hasHooks || traits.hasMcp) { emit(ctx, 'needs to breathe', ['Static check only'], { report, traits }); return 1; }
    const estimate = estimateUsage(opts, !!v.task, []);
    if (!ctx.json) {
      ctx.err(`Usage: ${estimate.abRuns} A/B runs, a verdict${v.task ? '' : ', and a task proposal'} (${estimate.agentCalls} agent calls).${estimate.maxUsd !== undefined ? ` Estimated budget: $${estimate.maxUsd}${opts.agent === 'codex' ? ' (not enforced by Codex)' : ' maximum'}.` : ''}`);
      if (estimate.warnThorough) ctx.err('This uses 6 runs of your subscription quota. Subscription limits assume individual use.');
    }
    if (!v.yes && !await (ctx.confirm as (q: string, signal?: AbortSignal) => Promise<boolean>)('Continue?', controller.signal)) throw new Error('Run cancelled');
    let task = v.task;
    if (!task) {
      let choices: string[];
      try {
        choices = await proposeTasks(ctx.platform, { agent: createAgents(ctx.platform)[opts.agent], sandbox: createLiteSandbox(ctx.platform, bins) }, { runId: crypto.randomUUID(), projectDir: resolve(v.project), skill, opts, signal: controller.signal });
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'TargetInResidueError') throw error;
        const location = opts.agent === 'codex' ? 'CODEX_HOME/skills or project skills' : 'project skills';
        const residue = [...new Set((error as Error & { residue: string[] }).residue)].sort();
        const contamination = { status: 'contaminated', common: [], extras: [], residue, targetInResidue: true };
        emit(ctx, 'needs to breathe', [`Shared residue: ${residue.length}${residue.length ? ` (${residue.map(humanField).join(', ')})` : ''}`, `${humanField(skill.name)} is already visible to both arms (${location}). Remove or rename it, then retry.`], { error: 'target-in-residue', contamination });
        return 1;
      }
      choices.forEach((choice, i) => ctx.err(`${i + 1}. ${choice}`));
      const select = (ctx as CliContext & { select?: (q: string, signal?: AbortSignal) => Promise<string> }).select;
      if (!select) throw new Error('Task selection requires interactive input');
      const choice = Number(await select('Choose a task (1-3): ', controller.signal));
      if (!Number.isInteger(choice) || choice < 1 || choice > 3) throw new Error('Invalid task selection');
      controller.signal.throwIfAborted();
      task = choices[choice - 1];
    }
    const events: Record<string, AgentEvent[]> = {};
    const seen = new Set<string>();
    const result = await runAB(ctx.platform, { agent: createAgents(ctx.platform)[opts.agent], sandbox: createLiteSandbox(ctx.platform, bins) }, {
      runId: crypto.randomUUID(), skill, identity: { source: skill.source, contentHash: await hashFiles(skill.files) }, staticGrade: report.grade, projectDir: resolve(v.project), task, opts, signal: controller.signal,
      onEvent: (arm, event) => { (events[arm] ??= []).push(event); if (!ctx.json && !seen.has(arm)) { seen.add(arm); ctx.err(`Running ${arm}...`); } },
    });
    await saveRun(ctx.platform, result, events);
    const residue = result.contamination.residue;
    const target = result.warnings.includes('target-in-residue');
    const human = [
      'Metric\tA\tB\tChange', ...compare(summarize(result.a), summarize(result.b)).map(r => `${r.metric}\t${r.a}\t${r.b}\t${r.deltaPct === null ? 'n/a' : `${r.deltaPct.toFixed(1)}%`}`),
      `Contamination: ${result.contamination.status}`, `Shared residue: ${residue.length}${residue.length ? ` (${residue.map(humanField).join(', ')})` : ''}`,
      ...(result.verdict ? [humanField(result.verdict.line)] : []),
      ...(target ? [`${humanField(skill.name)} is already visible to both arms (${opts.agent === 'codex' ? 'CODEX_HOME/skills or project skills' : 'project skills'}). Remove or rename it, then retry.`] : []),
      ...(result.warnings.includes('auth') ? [`Agent unavailable or not logged in. Install ${opts.agent} and log in, then retry.`] : []),
      ...result.warnings.map(w => `Warning: ${humanField(w)}`),
      ...(result.cleanupRecoveryPath ? [`Recovery path: ${humanField(result.cleanupRecoveryPath)}`] : []),
    ];
    emit(ctx, result.tag.replace(/^\/\/ somm: /, ''), human, result);
    return result.tag === '// somm: corked' ? 2 : target || result.warnings.some(w => ['auth', 'detect-timeout', 'budget', 'verdict-auth', 'verdict-budget', 'verdict-timeout', 'verdict-failed', 'cleanup-failed'].includes(w)) || !result.verdict || result.a.length !== (opts.runs === 'thorough' ? 3 : 1) || result.b.length !== (opts.runs === 'thorough' ? 3 : 1) || [...result.a, ...result.b].some(a => !a.ok) ? 1 : 0;
  } catch (error) {
    if (error instanceof RunCleanupError) {
      const message = controller.signal.aborted ? 'Run cancelled' : `${error.primaryName}: ${error.primaryMessage}`;
      const recovery = error.recoveryPath;
      emit(ctx, 'error', [humanField(message), `Cleanup failed: ${humanField(error.cleanupMessage)}`, ...(recovery ? [`Recovery path: ${humanField(recovery)}`] : [])], { error: message, primaryName: error.primaryName, cleanupError: error.cleanupMessage, recoveryPath: recovery }); return 1;
    }
    const message = controller.signal.aborted ? 'Run cancelled' : error instanceof Error ? error.message : String(error); emit(ctx, 'error', [humanField(message)], { error: message }); return 1;
  }
  finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
}
