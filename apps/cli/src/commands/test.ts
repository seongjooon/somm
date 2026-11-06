import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { createAgents, createLiteSandbox, runAB, saveRun, scanSkill, skillTraits, estimateUsage, summarize, compare, type AgentId, type AgentEvent, type RunOptions } from '@somm/core';
import { emit, humanField, type CliContext } from '../output';
import { loadSkill } from './install';

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
    const report = scanSkill(skill.files, { name: skill.name });
    const traits = skillTraits(skill.files);
    const bins = await ctx.platform.proc.which(['git', 'tar', 'cp', 'docker']);
    if (traits.hasScripts || traits.hasHooks || traits.hasMcp) { emit(ctx, 'needs to breathe', ['Static check only'], { report, traits }); return 1; }
    const estimate = estimateUsage(opts, !!v.task, []);
    if (!ctx.json) {
      ctx.err(`Usage: ${estimate.abRuns} A/B runs and a verdict (${estimate.agentCalls} agent calls).`);
      if (estimate.warnThorough) ctx.err('This uses 6 runs of your subscription quota. Subscription limits assume individual use.');
    }
    if (!v.yes && !await ctx.confirm('Continue?')) throw new Error('Run cancelled');
    let task = v.task;
    if (!task) {
      const choices = ['Add a focused test for existing behavior.', 'Improve error handling in a small existing feature.', 'Refactor a small module while preserving behavior.'];
      choices.forEach((choice, i) => ctx.err(`${i + 1}. ${choice}`));
      const select = (ctx as CliContext & { select?: (q: string) => Promise<string> }).select;
      if (!select) throw new Error('Task selection requires interactive input');
      const choice = Number(await select('Choose a task (1-3): '));
      if (!Number.isInteger(choice) || choice < 1 || choice > 3) throw new Error('Invalid task selection');
      task = choices[choice - 1];
    }
    const events: Record<string, AgentEvent[]> = {};
    const seen = new Set<string>();
    const result = await runAB(ctx.platform, { agent: createAgents(ctx.platform)[opts.agent], sandbox: createLiteSandbox(ctx.platform, bins) }, {
      runId: crypto.randomUUID(), skill, staticGrade: report.grade, projectDir: resolve(v.project), task, opts, signal: controller.signal,
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
    ];
    emit(ctx, result.tag.replace(/^\/\/ somm: /, ''), human, result);
    return target || result.warnings.includes('auth') ? 1 : result.tag === '// somm: corked' ? 2 : 0;
  } catch (error) { const message = controller.signal.aborted ? 'Run cancelled' : error instanceof Error ? error.message : String(error); emit(ctx, 'error', [humanField(message)], { error: message }); return 1; }
  finally { process.off('SIGINT', abort); process.off('SIGTERM', abort); }
}
