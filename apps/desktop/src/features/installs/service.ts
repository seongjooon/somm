import { createAgents, createSampleSource, fetchSkillFiles, hashFiles, installGate, readInstallMarker, readLocalSkill, restoreBackup, scanSkill, type AgentId, type Conflict, type DetectResult, type InstalledSkill, type Platform, type Scope, type SkillFile, type SkillMeta } from '@somm/core';
import { createTauriPlatform } from '../../platform';
import { updateAvailable } from './helpers';
import { inspectConflicts } from './conflicts';

export type Backup = { id: string; name: string; agent: AgentId; scope: Scope; created_at: string; action: string };
export type Prepared = { meta: SkillMeta; files: SkillFile[]; grade: string; gate: ReturnType<typeof installGate> };
export interface Service {
  detect(): Promise<Record<AgentId, DetectResult>>;
  list(project?: string): Promise<InstalledSkill[]>;
  plugins(agent: AgentId): Promise<string[]>;
  backups(): Promise<Backup[]>;
  conflicts(items: InstalledSkill[]): Promise<{ conflicts: Record<string, Conflict[]>; unreadable: string[] }>;
  update(item: InstalledSkill): Promise<boolean | null>;
  toggle(item: InstalledSkill): Promise<void>;
  uninstall(item: InstalledSkill): Promise<void>;
  restore(id: string, overwrite?: boolean): Promise<void>;
  prepare(id: string): Promise<Prepared>;
  install(prepared: Prepared, agent: AgentId, scope: Scope, project: string | undefined, mode: 'copy' | 'symlink', symlinkSource?: string, overwrite?: boolean): Promise<void>;
}

export async function createService(): Promise<Service> {
  if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) return (await import('./fake')).createFakeService();
  return realService(await createTauriPlatform());
}

export function realService(p: Platform): Service {
  const agents = createAgents(p);
  async function metadata(id: string) {
    const rows = await p.db.select<{ json: string }>('SELECT json FROM skills_cache WHERE id = ?', [id]);
    if (rows[0]) { try { return JSON.parse(rows[0].json) as SkillMeta; } catch { /* Fall back to the bundled catalog. */ } }
    return (await createSampleSource().fetchIndex()).find(item => item.id === id);
  }
  return {
    async detect() { const [claude, codex] = await Promise.all([agents.claude.detect(), agents.codex.detect()]); return { claude, codex }; },
    async list(project) { return (await Promise.all([agents.claude.listInstalled(project), agents.codex.listInstalled(project)])).flat(); },
    plugins: agent => agents[agent].listPlugins(),
    backups: () => p.db.select<Backup>("SELECT * FROM backups WHERE action = 'backup' ORDER BY created_at DESC"),
    conflicts: items => inspectConflicts(p, items),
    async update(item) {
      const marker = await readInstallMarker(p, item);
      if (!marker?.source) return null;
      const meta = await metadata(marker.source);
      if (!meta) return null;
      const hash = await hashFiles(await fetchSkillFiles(meta, p, { refresh: true }));
      return updateAvailable({ markerHash: marker.hash }, hash);
    },
    async toggle(item) { await agents[item.agent].setEnabled(item, !item.enabled); },
    async uninstall(item) { await agents[item.agent].uninstall(item); },
    async restore(id, overwrite) { await restoreBackup(p, id, { overwrite }); },
    async prepare(id) {
      const meta = await metadata(id);
      if (!meta) throw new Error('Skill not found');
      const files = await fetchSkillFiles(meta, p);
      const report = scanSkill(files, { name: meta.name });
      const hash = await hashFiles(files);
      const rows = await p.db.select<{ result_json: string; status: string; skill_id: string }>('SELECT result_json, status, skill_id FROM runs ORDER BY finished_at DESC');
      let blocked = false, tested = false;
      for (const row of rows) {
        try {
          const result = JSON.parse(row.result_json);
          const identity = result.meta?.identity;
          if (identity?.source !== meta.id || identity?.contentHash !== hash) {
            if (!identity && row.skill_id === meta.name && result.grade === 'F') blocked = true;
            continue;
          }
          if (result.grade === 'F') blocked = true;
          if (row.status === 'done' && result.verdict && Array.isArray(result.warnings) && !result.warnings.some((w: string) => ['auth', 'detect-timeout', 'budget', 'target-in-residue', 'verdict-auth', 'verdict-budget', 'verdict-timeout', 'verdict-failed', 'cleanup-failed'].includes(w))) tested = true;
        } catch { /* Invalid records do not establish a test result. */ }
      }
      const grade = blocked ? 'F' : report.grade;
      return { meta, files, grade, gate: installGate(grade, tested) };
    },
    async install(prepared, agent, scope, project, mode, symlinkSource, overwrite) {
      if (mode === 'symlink') {
        if (!symlinkSource) throw new Error('Select a local skill directory');
        const local = await readLocalSkill(symlinkSource, p);
        if (await hashFiles(local.files) !== await hashFiles(prepared.files)) throw new Error('Local skill does not match the scanned source');
      }
      await agents[agent].install({ name: prepared.meta.name, files: prepared.files, source: prepared.meta.id }, scope, { mode, projectDir: project, symlinkSource, overwrite });
    },
  };
}
