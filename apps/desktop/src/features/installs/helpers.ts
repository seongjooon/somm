import type { AgentId, InstalledSkill, Scope } from '@somm/core';

export function groupInstalled(items: InstalledSkill[]): Record<AgentId, Record<Scope, InstalledSkill[]>> {
  const groups: Record<AgentId, Record<Scope, InstalledSkill[]>> = {
    claude: { global: [], project: [] }, codex: { global: [], project: [] },
  };
  for (const item of items) groups[item.agent][item.scope].push(item);
  return groups;
}

export function updateAvailable(item: { markerHash?: string }, latestHash?: string): boolean {
  return !!item.markerHash && !!latestHash && item.markerHash !== latestHash;
}
