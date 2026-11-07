import { createSampleSource, detectConflicts, SkillExistsError, skillTraits, type AgentId, type Conflict, type InstalledSkill, type SkillFile } from '@somm/core';
import type { Backup, Service } from './service';

export async function createFakeService(): Promise<Service> {
  const item = (agent: AgentId, name: string, scope: 'global' | 'project', enabled = true): InstalledSkill => ({ agent, name, scope, enabled, dir: `/${agent}/${scope}/${name}`, hash: 'old', managedBySomm: true, isSymlink: false });
  let items = [item('claude', 'frontend-design', 'global'), item('claude', 'design-review', 'project'), item('codex', 'openai-docs', 'global'), item('codex', 'skill-installer', 'project', false)];
  let backups: Backup[] = [{ id: 'demo', name: 'frontend-design', agent: 'claude', scope: 'global', action: 'backup', created_at: '2026-11-07' }];
  const files: SkillFile[] = [{ path: 'SKILL.md', contents: 'design frontend' }, { path: 'commands/review.md', contents: 'review' }];
  const wait = async () => {};
  return {
    async detect() { return { claude: { installed: true, loggedIn: true }, codex: { installed: true, loggedIn: false } }; },
    async list(project) { return items.filter(i => i.scope === 'global' || project); },
    async plugins(agent) { return agent === 'claude' ? ['example-plugin'] : []; },
    async backups() { return backups; },
    async conflicts(all) {
      const result: Record<string, Conflict[]> = Object.fromEntries(all.map(i => [i.dir, []]));
      const claude = all.filter(i => i.agent === 'claude');
      if (claude.length > 1) for (const i of claude) result[i.dir] = detectConflicts({ name: i.name, text: '', traits: skillTraits(files) }, [{ name: 'other', text: '', traits: skillTraits(files) }]);
      return { conflicts: result, unreadable: [] };
    },
    async update(i) { return i.name === 'frontend-design'; },
    async toggle(i) { items = items.map(x => x === i ? { ...x, enabled: !x.enabled } : x); },
    async uninstall(i) { items = items.filter(x => x !== i); backups = [{ id: i.name, name: i.name, agent: i.agent, scope: i.scope, action: 'backup', created_at: '2026-11-07' }, ...backups]; },
    async restore(id, overwrite) { const b = backups.find(x => x.id === id); if (!b) throw new Error('Backup not found'); if (items.some(i => i.name === b.name && i.agent === b.agent) && !overwrite) throw new SkillExistsError(b.name); items = [...items.filter(i => i.name !== b.name || i.agent !== b.agent), item(b.agent, b.name, b.scope)]; },
    async prepare(id) { const meta = (await createSampleSource().fetchIndex()).find(i => i.id === id); if (!meta) throw new Error('Skill not found'); return { meta, files, grade: 'A', gate: 'direct' }; },
    async install(prepared, agent, scope, _project, _mode, _source, overwrite) { if (items.some(i => i.name === prepared.meta.name && i.agent === agent && i.scope === scope) && !overwrite) throw new SkillExistsError(prepared.meta.name); await wait(); items = [...items.filter(i => !(i.name === prepared.meta.name && i.agent === agent && i.scope === scope)), item(agent, prepared.meta.name, scope)]; },
  };
}
