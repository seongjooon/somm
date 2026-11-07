import { detectConflicts, readLocalSkill, skillText, skillTraits, type Conflict, type InstalledSkill, type Platform } from '@somm/core';

export async function inspectConflicts(p: Platform, items: InstalledSkill[]): Promise<{ conflicts: Record<string, Conflict[]>; unreadable: string[] }> {
  const unreadable: string[] = [];
  const descriptions = await Promise.all(items.map(async item => {
    try {
      const files = (await readLocalSkill(item.dir, p)).files;
      return { item, name: item.name, traits: skillTraits(files), text: files.map(f => skillText(f.contents) ?? '').join('\n') };
    } catch { unreadable.push(item.dir); return null; }
  }));
  const readable = descriptions.filter(entry => entry !== null);
  const conflicts: Record<string, Conflict[]> = {};
  for (const entry of readable) conflicts[entry.item.dir] = detectConflicts(entry, readable.filter(other => other !== entry && other.item.agent === entry.item.agent && other.item.enabled));
  return { conflicts, unreadable };
}
