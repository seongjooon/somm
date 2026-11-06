import type { SkillMeta, AgentId, SourceId, Grade } from '../types';

export type View = 'all-time' | 'hot-day' | 'hot-week' | 'hot-month' | 'hot-year';
const periods = { 'hot-day': 1, 'hot-week': 7, 'hot-month': 30, 'hot-year': 365 } as const;
const metric = (item: SkillMeta) => item.installs ?? item.stars ?? 0;
function start(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
function snapshot(item: SkillMeta, date: string) {
  return item.snapshots.filter(s => s.date <= date).sort((a, b) => b.date.localeCompare(a.date))[0];
}
export function availableViews(items: SkillMeta[], today: string): View[] {
  return ['all-time', ...(Object.keys(periods) as (keyof typeof periods)[])
    .filter(view => items.some(item => {
      const baseline = snapshot(item, start(today, periods[view]));
      const current = snapshot(item, today);
      return baseline && current && current.date > start(today, periods[view]);
    }))];
}
export function rank(items: SkillMeta[], view: View, today: string): SkillMeta[] {
  const values = items.map(item => {
    if (view === 'all-time') return metric(item);
    const before = snapshot(item, start(today, periods[view]));
    const now = snapshot(item, today);
    return before && now ? Math.max(0, now.value - before.value) : 0;
  });
  const maxima = new Map<SourceId, number>();
  items.forEach((item, i) => maxima.set(item.source, Math.max(maxima.get(item.source) ?? 0, values[i])));
  return items.map((item, i) => ({ item, score: values[i] / (maxima.get(item.source) || 1), i }))
    .sort((a, b) => b.score - a.score || a.i - b.i).map(row => row.item);
}
export function dedupe(items: SkillMeta[]): SkillMeta[] {
  const visible = items.filter(item => !item.isFork);
  const roots = visible.map((_, i) => i);
  const root = (i: number): number => roots[i] === i ? i : (roots[i] = root(roots[i]));
  const keys = new Map<string, number>();
  visible.forEach((item, i) => {
    const identities = [`repo:${JSON.stringify([item.repoUrl, item.path])}`];
    if (item.contentHash) identities.push(`hash:${item.contentHash}`);
    for (const key of identities) {
      const previous = keys.get(key);
      if (previous !== undefined) roots[root(i)] = root(previous);
      keys.set(key, i);
    }
  });
  const groups = new Map<number, SkillMeta>();
  visible.forEach((item, i) => {
    const id = root(i), previous = groups.get(id);
    if (!previous || metric(item) > metric(previous)) groups.set(id, item);
  });
  return [...groups.values()];
}
export function searchSkills(items: SkillMeta[], q: string): SkillMeta[] {
  const query = q.trim().toLowerCase();
  if (!query) return [...items];
  return [...items.filter(i => i.name.toLowerCase().includes(query)),
    ...items.filter(i => !i.name.toLowerCase().includes(query) && i.description.toLowerCase().includes(query))];
}
export interface Filters { category?: string; agent?: AgentId; source?: SourceId; license?: string; minGrade?: Grade }
export function filterSkills(items: SkillMeta[], f: Filters, grades: Record<string, Grade>): SkillMeta[] {
  const order: Grade[] = ['A', 'B', 'C', 'D', 'F'];
  return items.filter(i => (!f.category || i.category === f.category) && (!f.agent || i.agents.includes(f.agent))
    && (!f.source || i.source === f.source) && (!f.license || i.license === f.license)
    && (!f.minGrade || !grades[i.id] || order.indexOf(grades[i.id]) <= order.indexOf(f.minGrade)));
}
