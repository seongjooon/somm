import type { SkillMeta } from '@somm/core';
export interface MergeInput { today: string; previous: SkillMeta[]; fresh: SkillMeta[]; failureDays: Record<string, number>; sourcesFailed: string[] }
export function merge(input: MergeInput): { skills: SkillMeta[]; failureDays: Record<string, number>; publish: boolean; reason?: string } {
  const { today, previous, fresh, sourcesFailed } = input;
  const old = new Map(previous.map(s => [s.id, s]));
  const ids = new Set(fresh.map(s => s.id));
  const failureDays: Record<string, number> = {};
  const retained = previous.filter(s => {
    if (ids.has(s.id)) return false;
    const days = (input.failureDays[s.id] ?? 0) + 1;
    if (days >= 7) return false;
    failureDays[s.id] = days; return true;
  });
  const cutoff = new Date(`${today}T00:00:00Z`); cutoff.setUTCDate(cutoff.getUTCDate() - 399);
  const since = cutoff.toISOString().slice(0, 10);
  const skills = [...fresh, ...retained].map(s => {
    if (ids.has(s.id)) failureDays[s.id] = 0;
    const snapshots = (old.get(s.id)?.snapshots ?? s.snapshots).filter(x => x.date >= since && x.date !== today);
    if (s.stars !== undefined) snapshots.push({ date: today, value: s.stars });
    return { ...s, snapshots };
  });
  const reason = sourcesFailed.length ? `Source failure: ${sourcesFailed.join(', ')}` : skills.length < previous.length * 0.8 ? 'Skill count decreased by more than 20%' : undefined;
  return { skills, failureDays, publish: !reason, ...(reason ? { reason } : {}) };
}
