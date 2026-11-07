import { createAgents, createLiteSandbox, createSampleSource, fetchSkillFiles, proposeTasks, runAB, type AgentEvent, type Platform, type RunOptions, type SkillFile, type SkillMeta } from '@somm/core';
import { createTauriPlatform } from '../../platform';
import { getApiKey } from './session';
import { checkRunAllowed } from './guards';
import { saveResult } from './save';
import { tokenHistory } from './history';

export interface Skill { meta: SkillMeta; files: SkillFile[] }
export interface Request { skill: Skill; project: string; options: RunOptions; model?: string; task: string; signal: AbortSignal }
export async function loadSkill(id: string, p: Platform): Promise<Skill> {
  const rows = await p.db.select<{ json: string }>('SELECT json FROM skills_cache WHERE id = ?', [id]);
  const meta = rows[0] ? JSON.parse(rows[0].json) as SkillMeta : (await createSampleSource().fetchIndex()).find(s => s.id === id);
  if (!meta) throw new Error('Skill not found');
  return { meta, files: await fetchSkillFiles(meta, p) };
}
export async function createService() {
  const p = await createTauriPlatform();
  const bins = await p.proc.which(['git', 'tar', 'cp', 'docker', 'pnpm', 'npm', 'yarn', 'uv']);
  const deps = (options: RunOptions) => ({ agent: createAgents(p)[options.agent], sandbox: createLiteSandbox(p, bins) });
  const opts = (options: RunOptions): RunOptions => ({ ...options, ...(options.auth === 'isolated' ? { apiKey: getApiKey() } : {}) });
  return {
    load: (id: string) => loadSkill(id, p),
    async history(agent: RunOptions['agent']) {
      try { return tokenHistory(await p.db.select<{ metrics_json: string }>('SELECT run_arms.metrics_json FROM run_arms JOIN runs ON runs.id = run_arms.run_id WHERE runs.agent = ?', [agent])); }
      catch { return []; }
    },
    async propose(req: Omit<Request, 'task'>) {
      await checkRunAllowed(p, req.skill);
      return proposeTasks(p, deps(req.options), { runId: crypto.randomUUID(), projectDir: req.project, skill: req.skill.meta, opts: opts(req.options), model: req.model?.trim() || undefined, signal: req.signal });
    },
    async run(req: Request, onEvent: (arm: string, event: AgentEvent) => void, onCanaryHit?: (arm: string) => void) {
      const { report, hash } = await checkRunAllowed(p, req.skill);
      const events: Record<string, AgentEvent[]> = {};
      const runOptions = opts(req.options);
      const result = await runAB(p, deps(req.options), { runId: crypto.randomUUID(), skill: { name: req.skill.meta.name, files: req.skill.files }, identity: { source: req.skill.meta.id, contentHash: hash }, staticGrade: report.grade, projectDir: req.project, task: req.task, opts: runOptions, model: req.model?.trim() || undefined, signal: req.signal, onCanaryHit, onEvent: (arm, event) => { (events[arm] ??= []).push(event); onEvent(arm, event); } });
      await saveResult(p, Object.assign(result, { staticReport: report }), events, runOptions.apiKey);
      return { id: result.runId, cleanupFailed: result.warnings.includes('cleanup-failed'), recoveryPath: result.cleanupRecoveryPath };
    },
  };
}
export type Service = Awaited<ReturnType<typeof createService>>;
